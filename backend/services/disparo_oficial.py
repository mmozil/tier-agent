"""Disparo em lote pelo WhatsApp OFICIAL (Cloud API) — o lado do Agent (11/11/2026).

O ERP manda cada envio do disparo para `POST /integrations/tier/whatsapp-cloud/send-template`.
Até aqui o Agent só repassava o modelo à Meta e não guardava nada: quando o lead respondia,
o atendente e a IA não sabiam o que tinha sido enviado. Este módulo junta o que o disparo
precisa do lado do Agent:

1. **O envio entra na conversa** — texto do modelo renderizado (cabeçalho, corpo com as
   variáveis, rodapé e uma linha com os botões), `role="agent"`, `member_id=None`, marcado em
   `model_used` com `MARCA_DISPARO` para a IA ler no histórico e as métricas não contarem como
   atendimento humano. O modelo vem da Meta UMA vez a cada 10 min por número (cache em memória),
   não a cada contato de um lote de 5.000.
2. **Descadastro** — botão «Parar Mensagem» do modelo, ou «parar»/«sair»/«stop»/«descadastrar»
   escrito SOZINHO. Vale para o tenant inteiro e bloqueia só o DISPARO (409 no send-template);
   o atendimento segue. Frase longa não é descadastro.
3. **Retorno de entrega** — `statuses` do webhook da Cloud gravados por wamid, sem regredir,
   e o erro da Meta classificado: do NÚMERO/CONTA (o disparo para) ou do contato (segue).

Códigos de erro: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
"""

from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaWaDescadastro, TaWaEnvioStatus

logger = logging.getLogger(__name__)

# Marca do disparo no `model_used` da mensagem (o modelo vai depois: «Disparo · boas_vindas»).
# `agent_runtime.load_history` e `metricas_atendimento.calcular` leem por ela.
MARCA_DISPARO = "Disparo"

# O texto diz exatamente o que a supressão faz: tira o número da lista de ENVIOS (disparo). Não
# promete «nenhuma mensagem automática» — a IA e o follow-up continuam atendendo quem escrever.
CONFIRMACAO_DESCADASTRO = (
    "Pronto! Tiramos seu número da nossa lista de envios. Se precisar de algo, é só escrever aqui."
)
# Marca do modelo enviado pela equipe em `iniciar-conversa` (11/11/2026). Diferente da do disparo
# de propósito: a do disparo sai das métricas humanas; esta é uma pessoa abordando e conta.
MARCA_MODELO = "Modelo"


# ───────────────────────── descadastro: regras puras ─────────────────────────

# Resposta de BOTÃO (texto do botão do modelo, ou de lista/botão interativo).
DESCADASTRO_BOTAO = frozenset(
    {"parar mensagem", "parar mensagens", "parar", "sair", "stop", "descadastrar", "nao quero receber"}
)
# Texto LIVRE: só a palavra curta sozinha. «quero parar de pagar a mensalidade» não é descadastro.
DESCADASTRO_TEXTO = frozenset({"parar", "sair", "stop", "descadastrar"})


def normalizar(texto: str | None) -> str:
    """Minúsculas, sem acento, sem pontuação nem emoji, espaços colapsados. «Parar Mensagem 🛑!» →
    `parar mensagem`."""
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def eh_descadastro(texto: str | None, *, de_botao: bool) -> bool:
    """Candidato a descadastro. Botão vale sempre; a palavra curta em texto livre só vale se a
    última mensagem nossa foi um modelo (`ultima_nossa_foi_modelo`, conferido com o banco)."""
    n = normalizar(texto)
    return bool(n) and n in (DESCADASTRO_BOTAO if de_botao else DESCADASTRO_TEXTO)


def e_modelo(role: str | None, model_used: str | None) -> bool:
    """A linha é um modelo que NÓS mandamos — do disparo do ERP ou do `iniciar-conversa`."""
    return role == "agent" and (model_used or "").startswith((MARCA_DISPARO, MARCA_MODELO))


async def ultima_nossa_foi_modelo(db, *, phone_number_id: str | None, from_id: str) -> bool:
    """A última mensagem que NÓS mandamos a este contato (por este agente) foi um modelo?

    11/11/2026 — «parar»/«sair» escrito numa conversa comum («quer continuar ou parar?») é
    resposta, não pedido de descadastro: vai para a IA. Só depois de um modelo é pedido de parar.
    «Nós» = equipe (`agent`) ou IA (`assistant`); nota interna e a fala do contato não contam.
    """
    from services import agent_runtime

    conn = await agent_runtime.resolve_connector_by_instance(db, "whatsapp_cloud", phone_number_id)
    if not conn:
        return False
    linha = (
        await db.execute(
            select(TaMessageLog.role, TaMessageLog.model_used)
            .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
            .where(
                TaConversation.agent_id == conn.agent_id,
                TaConversation.connector_kind == "whatsapp_cloud",
                TaConversation.external_id == from_id,
                TaMessageLog.role.in_(("agent", "assistant")),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(1)
        )
    ).first()
    return bool(linha) and e_modelo(linha[0], linha[1])


def so_digitos(numero: str | None) -> str:
    return "".join(c for c in (numero or "").split("@")[0] if c.isdigit())


def chave_tolerante(numero: str | None) -> str:
    """DDD + 8 últimos dígitos — o casamento do ERP (`tier_vendas._ddd_e_final`): `5511987654321`
    e `551187654321` (sem o 9º dígito) dão a mesma chave `1187654321`. Número sem DDD
    reconhecível (estrangeiro, curto) fica com os dígitos inteiros — 8 dígitos sozinhos
    casariam gente demais para uma lista que BLOQUEIA envio."""
    d = so_digitos(numero)
    if len(d) < 8:
        return d
    if d.startswith("55") and len(d) >= 12:
        return d[2:4] + d[-8:]
    if len(d) in (10, 11):
        return d[:2] + d[-8:]
    return d


# ───────────────────────── erro da Meta: do número ou do contato? ─────────────────────────

# `conta=true` = o erro é do NÚMERO/CONTA (ou do modelo inteiro) e TODO envio seguinte vai falhar
# igual: o disparo deve parar. Conferido na tabela oficial (URL no topo do módulo) em 11/11/2026.
CODIGOS_CONTA: dict[int, str] = {
    # Autorização (200–299 = permissão, tratado como faixa em `erro_e_da_conta`)
    0: "token inválido, expirado ou bloqueado",
    3: "capacidade/permissão da app",
    10: "permissão não concedida ou retirada",
    190: "token expirado",
    131005: "permissão não concedida ou retirada",
    # Limite de envio
    4: "limite de chamadas da app",
    80007: "limite de chamadas da conta (WABA)",
    130429: "limite de vazão da Cloud API",
    131048: "envio restrito no número (bloqueios/spam)",
    131064: "limite por violação de classificação de modelo",
    # Integridade
    368: "conta restrita/desativada por política",
    130497: "conta impedida de enviar para o país",
    131031: "conta restrita/desativada",
    # Conta/número
    33: "número apagado",
    131037: "número sem nome de exibição aprovado",
    131042: "problema na forma de pagamento",
    131045: "número com erro de registro",
    131057: "conta em manutenção",
    131063: "modelos de marketing desligados na configuração",
    133010: "número não registrado na plataforma",
    # Do MODELO — não é do número, mas todo contato do disparo falha igual
    132001: "modelo não existe no idioma ou não está aprovado",
    132015: "modelo pausado por qualidade",
    132016: "modelo desativado",
}


# 131050 = «o contato parou de receber mensagens de marketing» (tabela da Meta). É do contato
# (`conta=false`) e, além disso, entra na lista de descadastro do tenant — no envio e no webhook.
CODIGO_PAROU_MARKETING = 131050
TEXTO_PAROU_MARKETING = "Meta 131050"


def erro_e_da_conta(meta_code: int | None, http_status: int | None = None) -> bool:
    """Erro do DESTINATÁRIO (131026 sem WhatsApp, 131047 fora da janela, 131049/131050 marketing,
    131056 par remetente-destinatário, 130403 bloqueou) é `False`: o disparo segue para os outros."""
    if meta_code is None:
        return http_status in (401, 403)
    return meta_code in CODIGOS_CONTA or 200 <= meta_code <= 299


# ───────────────────────── o texto do modelo como o contato vê ─────────────────────────

_VAR = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")
_MIDIA_PT = {"IMAGE": "Imagem", "VIDEO": "Vídeo", "DOCUMENT": "Documento", "LOCATION": "Localização"}


def _valor(p: dict) -> str:
    t = (p or {}).get("type")
    if t in ("currency", "date_time"):
        return str(((p.get(t) or {}).get("fallback_value")) or "")
    return str((p or {}).get("text") or "")


def parametros(components: list | None, tipo: str) -> tuple[list[str], dict[str, str]]:
    """(posicionais, nomeados) do componente `tipo` (`body`/`header`) que o ERP mandou à Meta."""
    pos: list[str] = []
    nom: dict[str, str] = {}
    for c in components or []:
        if not isinstance(c, dict) or str(c.get("type") or "").lower() != tipo:
            continue
        for p in c.get("parameters") or []:
            if not isinstance(p, dict):
                continue
            if p.get("parameter_name"):
                nom[str(p["parameter_name"])] = _valor(p)
            else:
                pos.append(_valor(p))
    return pos, nom


def _trocar_nomeados(texto: str, nomeados: dict[str, str]) -> str:
    return _VAR.sub(lambda m: nomeados.get(m.group(1), m.group(0)) if not m.group(1).isdigit() else m.group(0), texto)


def texto_do_disparo(modelo: dict | None, nome: str, components: list | None) -> str:
    """O texto que vai para a conversa. `modelo` = `resumo_do_modelo` (ou None se a Meta não
    devolveu): sem ele, uma linha honesta com o nome do modelo e as variáveis."""
    from routes.whatsapp_oficial import texto_enviado

    corpo_pos, corpo_nom = parametros(components, "body")
    if not modelo:
        base = f"[Modelo «{nome}» enviado]"
        valores = corpo_pos + list(corpo_nom.values())
        return f"{base}\n{' · '.join(valores)}" if valores else base
    partes: list[str] = []
    if modelo.get("cabecalho"):
        cab_pos, cab_nom = parametros(components, "header")
        partes.append(texto_enviado(_trocar_nomeados(modelo["cabecalho"], cab_nom), cab_pos))
    elif modelo.get("cabecalho_midia"):
        fmt = str(modelo["cabecalho_midia"]).upper()
        partes.append(f"[{_MIDIA_PT.get(fmt, fmt.title())}]")
    partes.append(
        texto_enviado(_trocar_nomeados(modelo.get("corpo") or "", corpo_nom), corpo_pos, modelo.get("rodape"))
    )
    if modelo.get("botoes"):
        partes.append("[Botões: " + " · ".join(modelo["botoes"]) + "]")
    return "\n\n".join(p for p in partes if p and p.strip())


# ───────────────────────── cache do modelo (por número, nome, idioma) ─────────────────────────

TTL_MODELO_S = 600  # 10 min — um lote de 5.000 consulta a Meta uma vez
TTL_FALHA_S = 60  # Meta fora / modelo inexistente: não martelar a cada contato
_cache_modelos: dict[tuple[int, str, str], tuple[float, dict | None]] = {}
_lista_buscada_ate: dict[int, float] = {}  # por número: até quando a lista inteira da Meta vale


async def _buscar_modelos(cfg: dict) -> list[dict]:
    """Todos os modelos do número na Meta (qualquer status). Ponto único para o teste trocar."""
    from routes.whatsapp_oficial import _modelos_da_meta
    from services.connectors.adapters.whatsapp_cloud import resolve_cloud_creds
    from services.connectors.base import ConnectorConfig

    _pnid, token = resolve_cloud_creds(ConnectorConfig(data=cfg))
    return await _modelos_da_meta({**cfg, "token": token})


async def modelo_do_cache(connector_id: int, cfg: dict, nome: str, idioma: str) -> dict | None:
    """`resumo_do_modelo` do modelo (ou None). Uma busca na Meta preenche TODOS os modelos do
    número; o que não veio fica guardado como «não existe» pelo mesmo prazo."""
    from routes.whatsapp_oficial import resumo_do_modelo

    chave = (connector_id, nome or "", idioma or "")
    agora = time.monotonic()
    hit = _cache_modelos.get(chave)
    if hit and hit[0] > agora:
        return hit[1]
    lista_ate = _lista_buscada_ate.get(connector_id, 0.0)
    if lista_ate > agora:  # a lista do número é recente e não tinha este modelo
        _cache_modelos[chave] = (lista_ate, None)
        return None
    try:
        lista = await _buscar_modelos(cfg)
    except Exception as e:  # noqa: BLE001 — sem o modelo, a conversa leva a linha genérica
        logger.warning("disparo: modelos da Meta indisponíveis connector=%s: %s", connector_id, e)
        _cache_modelos[chave] = (agora + TTL_FALHA_S, None)
        return None
    validade = agora + TTL_MODELO_S
    _lista_buscada_ate[connector_id] = validade
    for t in lista or []:
        r = resumo_do_modelo(t)
        _cache_modelos[(connector_id, r.get("nome") or "", r.get("idioma") or "")] = (validade, r)
    if chave not in _cache_modelos or _cache_modelos[chave][0] != validade:
        _cache_modelos[chave] = (validade, None)
    return _cache_modelos[chave][1]


# ───────────────────────── o envio entra na conversa ─────────────────────────


async def gravar_disparo_na_conversa(
    db, conn: TaConnector, wa_id: str, texto: str, nome_modelo: str, contact_name: str | None = None
) -> int:
    """Acha/abre a conversa do contato NAQUELE número e grava o modelo enviado. Não mexe no
    status da conversa (assumida continua assumida) nem atribui a ninguém. Devolve o id.
    `contact_name` (o nome da lista do disparo) só preenche conversa SEM nome."""
    from services import agent_runtime

    conv = await agent_runtime.ensure_conversation(
        db,
        agent_id=conn.agent_id,
        connector_kind="whatsapp_cloud",
        external_id=wa_id,
        contact_name=(contact_name or "").strip()[:120] or None,
        connector_id=conn.id,
        por_numero=True,
    )
    db.add(
        TaMessageLog(
            conversation_id=conv.id,
            role="agent",
            content=(texto or "")[:8000],
            member_id=None,
            model_used=f"{MARCA_DISPARO} · {nome_modelo}"[:128],
        )
    )
    conv.last_message_at = datetime.utcnow()
    await db.commit()
    return conv.id


# ───────────────────────── o envio de UM modelo (serviço comum) ─────────────────────────


def detalhe_erro_envio(e: Exception) -> dict:
    """Erro do envio na forma do contrato com o ERP (11/11/2026). `conta=true` = o erro é do
    NÚMERO/CONTA (ou do modelo inteiro) e o disparo deve parar; `false` = só deste contato.
    Erro antes de falar com a Meta (config sem token) também é `conta`: nenhum envio sai."""
    from services.connectors.base import ConnectorError

    if isinstance(e, ConnectorError):
        code = getattr(e, "meta_code", None)
        http = e.status_code
        conta = True if http is None else erro_e_da_conta(code, http)
        mensagem = getattr(e, "detalhe", None) or str(e)
    else:  # rede/timeout: transitório, não é da conta
        code, conta, mensagem = None, False, f"{type(e).__name__}: {e}"
    return {"codigo": "meta_error", "meta_code": code, "conta": conta, "mensagem": str(mensagem)[:500]}


class ErroDeEnvio(Exception):
    """A Meta (ou a rede) recusou o envio. `detalhe` = o mesmo dicionário do 502 do send-template."""

    def __init__(self, detalhe: dict):
        super().__init__(detalhe.get("mensagem") or "falha no envio")
        self.detalhe = detalhe


async def enviar_modelo(
    db,
    *,
    tenant_id: int,
    conn,
    cfg: dict,
    impl,
    to: str,
    template_name: str,
    lang: str,
    components: list | None,
    modelo: dict | None = None,
    contact_name: str | None = None,
) -> dict:
    """Envia UM modelo aprovado e faz o que vem depois — o caminho do send-template do ERP e do
    disparo em lote da tela do Agent (11/11/2026), escrito uma vez só.

    1. Envia. Recusa → `ErroDeEnvio` (131050 entra antes na lista de descadastro do tenant).
    2. O modelo entra na conversa do contato naquele número (`MARCA_DISPARO`).
    3. O wamid nasce `accepted` em `ta_wa_envio_status`.
    Falha em 2 ou 3 NÃO desfaz o envio: loga e segue.

    NÃO confere o descadastro — quem chama confere antes (a rota do ERP devolve 409; o lote
    marca o contato). `modelo` = `resumo_do_modelo` já em mãos (o lote guarda o do momento da
    criação); sem ele vem do cache. `cfg` = config do conector já decifrada.
    """
    from services.connectors.base import ConnectorConfig

    conn_id = conn.id
    try:
        res = await impl.send_template(ConnectorConfig(data=cfg), to, template_name, lang, components)
    except Exception as e:  # noqa: BLE001
        detalhe = detalhe_erro_envio(e)
        logger.warning(
            "disparo cloud recusado tenant=%s connector=%s meta_code=%s conta=%s",
            tenant_id,
            conn_id,
            detalhe["meta_code"],
            detalhe["conta"],
        )
        # 131050 = o contato parou de receber marketing deste número: entra na lista do tenant,
        # e o próximo disparo para ele já volta 409 sem gastar chamada na Meta.
        if detalhe["meta_code"] == CODIGO_PAROU_MARKETING:
            try:
                await registrar_descadastro(
                    db, tenant_id=tenant_id, connector_id=conn_id, numero=to, texto=TEXTO_PAROU_MARKETING
                )
            except Exception:  # noqa: BLE001
                logger.exception("disparo cloud: 131050 não entrou na lista tenant=%s", tenant_id)
                await db.rollback()
        raise ErroDeEnvio(detalhe) from e
    msg_id = None
    wa_id = None
    try:
        msg_id = (res.get("messages") or [{}])[0].get("id")
        # O endereço que a Meta devolve é o que vem nas respostas do contato (com ou sem o 9).
        wa_id = (res.get("contacts") or [{}])[0].get("wa_id")
    except Exception:  # noqa: BLE001
        pass
    wa_id = wa_id or so_digitos(to)

    conversation_id = None
    try:
        if modelo is None:
            modelo = await modelo_do_cache(conn_id, cfg, template_name, lang)
        texto = texto_do_disparo(modelo, template_name, components)
        conversation_id = await gravar_disparo_na_conversa(
            db, conn, wa_id, texto, template_name, contact_name=contact_name
        )
    except Exception:  # noqa: BLE001 — o envio já saiu; a conversa é complemento
        logger.exception("disparo cloud: enviado mas não entrou na conversa connector=%s", conn_id)
        await db.rollback()
    if msg_id:
        try:
            await registrar_status(
                db,
                wamid=msg_id,
                status="accepted",
                tenant_id=tenant_id,
                connector_id=conn_id,
                conversation_id=conversation_id,
                destino=wa_id,
            )
        except Exception:  # noqa: BLE001
            logger.exception("disparo cloud: status inicial não gravou wamid=%s", msg_id)
            await db.rollback()
    return {"ok": True, "message_id": msg_id, "wa_id": wa_id, "conversation_id": conversation_id, "raw": res}


# ───────────────────────── descadastro: banco ─────────────────────────


async def esta_descadastrado(db, tenant_id: int, numero: str | None) -> bool:
    chave = chave_tolerante(numero)
    if not chave:
        return False
    r = await db.execute(
        select(TaWaDescadastro.id)
        .where(TaWaDescadastro.tenant_id == tenant_id, TaWaDescadastro.chave == chave)
        .limit(1)
    )
    return r.scalars().first() is not None


async def registrar_descadastro(
    db, *, tenant_id: int, connector_id: int | None, numero: str, texto: str | None
) -> bool:
    """Grava o pedido (idempotente). True = entrou agora; False = já estava na lista."""
    chave = chave_tolerante(numero)
    if not chave:
        return False
    if await esta_descadastrado(db, tenant_id, numero):
        return False
    db.add(
        TaWaDescadastro(
            tenant_id=tenant_id,
            numero=so_digitos(numero)[:32],
            chave=chave[:32],
            connector_id=connector_id,
            texto=(texto or "")[:255] or None,
            criado_em=datetime.utcnow(),
        )
    )
    try:
        await db.commit()
    except IntegrityError:  # o mesmo contato apertou duas vezes ao mesmo tempo
        await db.rollback()
        return False
    return True


async def tratar_descadastro(
    db, *, phone_number_id: str | None, from_id: str, sender_name: str | None, texto: str
) -> dict:
    """O contato pediu para parar: grava, deixa a mensagem na conversa e confirma UMA vez.
    A IA não é chamada neste turno. Cada passo é independente: falha num não derruba o outro,
    mas sem a gravação da lista não se promete nada ao contato."""
    from core.encryption import decrypt
    from services import agent_runtime
    from services.connectors.base import ConnectorConfig, OutboundMessage
    from services.connectors.registry import registry

    conn = await agent_runtime.resolve_connector_by_instance(db, "whatsapp_cloud", phone_number_id)
    if not conn:
        return {"status": "no_connector"}
    agente = await db.get(TaAgent, conn.agent_id)
    if not agente:
        return {"status": "no_agent"}
    tenant_id = agente.tenant_id

    gravou = False
    try:
        await registrar_descadastro(db, tenant_id=tenant_id, connector_id=conn.id, numero=from_id, texto=texto)
        gravou = True
    except Exception:  # noqa: BLE001
        logger.exception("descadastro: falhou gravar tenant=%s", tenant_id)
        await db.rollback()

    conv_id = None
    try:
        conv = await agent_runtime.ensure_conversation(
            db,
            agent_id=agente.id,
            connector_kind="whatsapp_cloud",
            external_id=from_id,
            contact_name=sender_name,
            connector_id=conn.id,
        )
        conv_id = conv.id
        await agent_runtime.log_message(db, conversation_id=conv.id, tenant_id=tenant_id, role="user", content=texto)
    except Exception:  # noqa: BLE001
        logger.exception("descadastro: falhou gravar a mensagem na conversa tenant=%s", tenant_id)
        await db.rollback()

    confirmou = False
    if gravou:
        try:
            cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
            await registry.get("whatsapp_cloud").send(
                cfg, OutboundMessage(external_chat_id=from_id, content=CONFIRMACAO_DESCADASTRO)
            )
            confirmou = True
        except Exception:  # noqa: BLE001
            logger.exception("descadastro: confirmação não saiu connector=%s", conn.id)
    if confirmou and conv_id:
        try:
            await agent_runtime.log_message(
                db, conversation_id=conv_id, tenant_id=tenant_id, role="assistant", content=CONFIRMACAO_DESCADASTRO
            )
        except Exception:  # noqa: BLE001
            logger.exception("descadastro: confirmação saiu mas não entrou na conversa %s", conv_id)
            await db.rollback()
    logger.info("descadastro tenant=%s connector=%s gravou=%s confirmou=%s", tenant_id, conn.id, gravou, confirmou)
    return {"status": "descadastro", "gravou": gravou, "confirmou": confirmou, "conversation_id": conv_id}


# ───────────────────────── retorno de entrega (statuses) ─────────────────────────

# Só avança. `failed` é final (nada passa dele). Status desconhecido é ignorado.
ORDEM_STATUS = {"accepted": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 9}


def preco_do_status(s: dict | None) -> dict:
    """Colunas de cobrança a partir de UM item de `statuses` do webhook (12/11/2026). Puro.

    Formato (doc oficial, «status messages webhook»): `pricing = {billable, pricing_model, type,
    category, subtype?}` e `conversation.origin.type`. O `pricing` aparece UMA vez por mensagem: no
    `sent` OU em um dos `delivered`/`read` («can only appear in one or the other»), nunca no
    `failed`; por isso é gravado à parte da ordem do status (ver `registrar_status`). Devolve SÓ o
    que veio: chave ausente não apaga nada.
    https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
    """
    if not isinstance(s, dict):
        return {}
    p = s.get("pricing") if isinstance(s.get("pricing"), dict) else {}
    conv = s.get("conversation") if isinstance(s.get("conversation"), dict) else {}
    origem = conv.get("origin") if isinstance(conv.get("origin"), dict) else {}

    def _txt(v, n: int) -> str | None:
        t = str(v).strip().lower() if v is not None else ""
        return t[:n] or None

    out: dict = {}
    if isinstance(p.get("billable"), bool):
        out["cobravel"] = p["billable"]
    for chave, coluna, n in (
        ("type", "tipo_preco", 32),
        ("category", "categoria_preco", 32),
        ("subtype", "subtipo_preco", 32),
    ):
        v = _txt(p.get(chave), n)
        if v:
            out[coluna] = v
    modelo = str(p.get("pricing_model") or "").strip().upper()[:8]
    if modelo:
        out["modelo_preco"] = modelo
    v = _txt(origem.get("type"), 32)
    if v:
        out["origem_conversa"] = v
    return out


async def registrar_status(
    db,
    *,
    wamid: str | None,
    status: str | None,
    tenant_id: int | None = None,
    connector_id: int | None = None,
    erro_codigo: int | None = None,
    erro: str | None = None,
    em: datetime | None = None,
    conversation_id: int | None = None,
    destino: str | None = None,
    preco: dict | None = None,
) -> bool:
    """Grava/avança o status de um wamid. Idempotente e à prova de ordem: o UPDATE só pega a linha
    se a ordem nova for MAIOR (atômico, vale entre os dois workers). True = mudou o status.

    `preco` (de `preco_do_status`) entra SEMPRE que vier, mesmo quando o status não avança: o
    `pricing` pode chegar no `sent` atrasado, depois do `delivered`."""
    status = (status or "").strip().lower()
    ordem = ORDEM_STATUS.get(status)
    if not wamid or ordem is None:
        return False
    T = TaWaEnvioStatus
    preco = {k: v for k, v in (preco or {}).items() if v is not None and hasattr(T, k)}
    agora = datetime.utcnow()
    falhou = status == "failed"
    novos = {
        "status": status,
        "ordem": ordem,
        "erro_codigo": erro_codigo if falhou else None,
        "erro": ((erro or "")[:500] or None) if falhou else None,
        "status_em": em or agora,
        "atualizado_em": agora,
    }
    for _ in range(2):
        r = await db.execute(
            update(T)
            .where(T.wamid == wamid, T.ordem < ordem)
            .values(**novos)
            .execution_options(synchronize_session=False)
        )
        avancou = (r.rowcount or 0) > 0
        if not avancou:
            existe = (await db.execute(select(T.id).where(T.wamid == wamid))).scalars().first()
            if existe is None:
                db.add(
                    T(
                        wamid=wamid[:128],
                        tenant_id=tenant_id,
                        connector_id=connector_id,
                        conversation_id=conversation_id,
                        destino=(destino or None),
                        criado_em=agora,
                        **novos,
                        **preco,
                    )
                )
                try:
                    await db.commit()
                    return True
                except IntegrityError:  # o webhook gravou o mesmo wamid neste instante: tenta o UPDATE de novo
                    await db.rollback()
                    continue
        # O que o envio sabe e o webhook não (e vice-versa) entra sem depender da ordem.
        compl = {}
        for campo, valor in (
            ("tenant_id", tenant_id),
            ("connector_id", connector_id),
            ("conversation_id", conversation_id),
            ("destino", destino),
        ):
            if valor:
                compl[campo] = func.coalesce(getattr(T, campo), valor)
        # Cobrança da Meta: o que veio agora vale (o `pricing` vem uma vez por mensagem; repetido, é igual).
        compl.update(preco)
        if compl:
            await db.execute(
                update(T).where(T.wamid == wamid).values(**compl).execution_options(synchronize_session=False)
            )
        await db.commit()
        return avancou
    return False


def _int(v) -> int | None:
    try:
        return int(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _quando(ts) -> datetime | None:
    """`timestamp` da Meta (segundos Unix, em texto) → UTC sem fuso, como o resto do banco."""
    n = _int(ts)
    if n is None:
        return None
    try:
        return datetime.fromtimestamp(n, UTC).replace(tzinfo=None)
    except (OverflowError, OSError, ValueError):
        return None


TTL_NUMERO_S = 300
_cache_numeros: dict[str, tuple[float, tuple[int, int] | None]] = {}


async def conector_do_numero(db, phone_number_id: str | None) -> tuple[int, int] | None:
    """(connector_id, tenant_id) do número oficial. Cache curto: um lote de 5.000 gera ~15 mil
    avisos de status, e achar o número decifra a config de todos os conectores Cloud."""
    from services import agent_runtime

    if not phone_number_id:
        return None
    agora = time.monotonic()
    hit = _cache_numeros.get(phone_number_id)
    if hit and hit[0] > agora:
        return hit[1]
    alvo = None
    conn = await agent_runtime.resolve_connector_by_instance(db, "whatsapp_cloud", str(phone_number_id))
    if conn:
        agente = await db.get(TaAgent, conn.agent_id)
        if agente:
            alvo = (conn.id, agente.tenant_id)
    _cache_numeros[phone_number_id] = (agora + (TTL_NUMERO_S if alvo else TTL_FALHA_S), alvo)
    return alvo


async def registrar_statuses_do_webhook(db, phone_number_id: str | None, statuses: list) -> int:
    """`value.statuses` do webhook da Cloud. Um item com defeito não derruba os outros."""
    alvo = await conector_do_numero(db, phone_number_id)
    if not alvo:
        return 0
    connector_id, tenant_id = alvo
    n = 0
    for s in statuses or []:
        if not isinstance(s, dict):
            continue
        try:
            erros = s.get("errors") or []
            e0 = erros[0] if erros and isinstance(erros[0], dict) else {}
            codigo = _int(e0.get("code"))
            if await registrar_status(
                db,
                wamid=s.get("id"),
                status=s.get("status"),
                tenant_id=tenant_id,
                connector_id=connector_id,
                erro_codigo=codigo,
                erro=e0.get("title") or e0.get("message"),
                em=_quando(s.get("timestamp")),
                destino=s.get("recipient_id"),
                preco=preco_do_status(s),
            ):
                n += 1
            if str(s.get("status") or "").lower() == "failed" and codigo == CODIGO_PAROU_MARKETING:
                await _descadastro_por_131050(db, tenant_id, connector_id, s)
        except Exception:  # noqa: BLE001
            logger.exception("status whatsapp-cloud falhou wamid=%s", s.get("id"))
            await db.rollback()
    return n


async def _descadastro_por_131050(db, tenant_id: int, connector_id: int, s: dict) -> None:
    """Status `failed` 131050 no webhook: o contato entra na lista do tenant (texto «Meta 131050»).
    O número vem do `recipient_id`; sem ele, do destino gravado no envio."""
    numero = s.get("recipient_id")
    if not numero and s.get("id"):
        numero = (await db.execute(select(TaWaEnvioStatus.destino).where(TaWaEnvioStatus.wamid == s["id"]))).scalar()
    if numero:
        await registrar_descadastro(
            db, tenant_id=tenant_id, connector_id=connector_id, numero=numero, texto=TEXTO_PAROU_MARKETING
        )


def _iso(dt: datetime | None) -> str | None:
    return dt.replace(microsecond=0).isoformat() + "Z" if dt else None


async def status_dos_envios(db, tenant_id: int, ids: list[str]) -> dict[str, dict]:
    """Status dos wamids pedidos — só dos números (conectores) deste tenant. Id desconhecido
    ou de outro tenant simplesmente não aparece."""
    ids = list(dict.fromkeys(str(i) for i in ids or [] if i))
    if not ids:
        return {}
    T = TaWaEnvioStatus
    do_tenant = (
        select(TaConnector.id).join(TaAgent, TaAgent.id == TaConnector.agent_id).where(TaAgent.tenant_id == tenant_id)
    )
    rows = (
        await db.execute(
            select(T.wamid, T.status, T.erro_codigo, T.erro, T.status_em, T.atualizado_em).where(
                T.wamid.in_(ids), T.connector_id.in_(do_tenant)
            )
        )
    ).all()
    return {
        w: {"status": st, "erro_codigo": cod, "erro": err, "em": _iso(em or atu)} for w, st, cod, err, em, atu in rows
    }
