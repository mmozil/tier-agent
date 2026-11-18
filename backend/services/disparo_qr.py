"""Disparo pelo WhatsApp NÃO oficial (motor Baileys, número conectado por QR) — 18/11/2026.

Pedido do dono: «crie disparos também para as APIs não oficiais». A página «Disparos» só servia o
número oficial (modelo aprovado pela Meta). No número por QR não existe modelo: a mensagem é um
TEXTO escrito na hora, com {{nome}} no lugar do primeiro nome da lista.

O disparo é o MESMO (`ta_disparo_oficial` com `tipo='texto'`), na MESMA fila e com as MESMAS
travas de `services/disparo_lote.py` (vez do disparo, SKIP LOCKED, pausa por falha, descadastro).
Muda o envio de cada contato, que mora aqui:

1. «Esse número tem WhatsApp?» — `POST /on-whatsapp` no motor ANTES de mandar. Mandar para número
   sem WhatsApp é o que mais chama atenção do WhatsApp num número não oficial; e o endereço que
   volta (`jid`, com ou sem o 9) é o mesmo da resposta do contato — a conversa é uma só.
2. «digitando…» por 1,5 a 3,5 s, e então o texto.
3. O eco: no modo registro o Baileys devolve o envio como `fromMe` e ele entraria de novo na
   conversa — o id é carimbado antes (`proactive.marcar_eco_do_envio`).
4. O envio entra na conversa do contato naquele número, marcado «Disparo · nome do disparo» (como
   no oficial: a IA lê no histórico e as métricas não contam como atendimento humano).
5. `ta_wa_envio_status` nasce `accepted` SEM a conversa: o histórico do card no CRM só pega status
   com conversa, e lá ele é escrito como «WhatsApp oficial» — o envio do celular da consultora
   apareceria como do número oficial. Levar ao card pede o CRM rotular pelo número (próximo passo).
   🚨 Entregue e lido NÃO existem aqui: o motor não manda a confirmação ao Agent (medido 18/11/2026:
   0 `messages.update` em ~200 mil eventos do motor). O disparo conta enviado e quem respondeu.

Descadastro: «parar», «sair», «stop» ou «descadastrar» escrito SOZINHO, quando a última mensagem
nossa na conversa foi um disparo, entra na lista do tenant — a mesma do oficial (`ta_wa_descadastro`).

🚨 Bloqueio do número: o WhatsApp derruba número não oficial que manda muito para quem não o tem
salvo. Por isso o intervalo padrão é 30 s (mínimo 10), a lista vai até 1.000 contatos e a pausa por
taxa de falha (>30% depois de 20) vale igual. No CCDA e na M7 os números em modo registro são o
celular das consultoras.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import re
from datetime import datetime

import httpx
from sqlalchemy import select

from models import TaAgent, TaConversation, TaMessageLog
from services import disparo_oficial
from services.disparo_oficial import MARCA_DISPARO

logger = logging.getLogger(__name__)

TIPO = "texto"  # `ta_disparo_oficial.tipo` do disparo não oficial (o oficial é «modelo»)
KIND = "whatsapp"  # `ta_connector.kind` do número por QR (o oficial é «whatsapp_cloud»)

INTERVALO_PADRAO_S = 30
INTERVALO_MIN_S = 10
VARIACAO_FRACAO = 0.3
LIMITE_CONTATOS = 1000
TEXTO_MAX = 4000
DIGITANDO_S = (1.5, 3.5)

SEM_WHATSAPP = "Este número não tem WhatsApp"
SEM_CONFIRMACAO = "O motor do WhatsApp não confirmou o envio — pode ter saído; não foi tentado de novo"

_NOME = re.compile(r"\{\{\s*nome\s*\}\}", re.I)
_OUTRA_VARIAVEL = re.compile(r"\{\{([^{}]*)\}\}")


# ───────────────────────── o texto (regra pura) ─────────────────────────


def validar_texto(texto: str | None) -> str:
    """O texto como vai ser gravado. A única variável é {{nome}}; outra {{…}} sairia literal."""
    t = (texto or "").replace("\r\n", "\n").strip()
    if not t:
        raise ValueError("Escreva a mensagem")
    if len(t) > TEXTO_MAX:
        raise ValueError(f"A mensagem passa de {TEXTO_MAX:,} caracteres".replace(",", "."))
    outra = _OUTRA_VARIAVEL.search(_NOME.sub("", t))
    if outra:
        raise ValueError(
            f"«{{{{{outra.group(1).strip()}}}}}» não existe — a única variável é {{{{nome}}}} (primeiro nome da lista)"
        )
    return t


def usa_nome(texto: str | None) -> bool:
    return bool(_NOME.search(texto or ""))


def texto_do_contato(texto: str, primeiro_nome: str | None) -> str | None:
    """O texto deste contato. None = o texto pede o nome e a lista não trouxe (não inventamos)."""
    if not usa_nome(texto):
        return texto
    if not primeiro_nome:
        return None
    return _NOME.sub(primeiro_nome, texto)


# ───────────────────────── o motor ─────────────────────────


class ErroDoEnvio(Exception):
    """O envio não saiu. `conta=True` = o problema é do NÚMERO (desconectado, chave recusada, motor
    fora): todo contato seguinte falharia igual e o disparo pausa. `False` = só deste contato."""

    def __init__(self, mensagem: str, *, conta: bool):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.conta = conta


def _base(cfg: dict) -> tuple[str, dict]:
    from core.config import get_settings

    instance_id, api_key = cfg.get("instance_id"), cfg.get("api_key")
    if not instance_id or not api_key:
        raise ErroDoEnvio("O número não tem a configuração do motor — refaça a conexão em Canais", conta=True)
    url = f"{get_settings().tier_whatsapp_engine_url}/v1/instances/{instance_id}"
    return url, {"X-API-Key": api_key, "Content-Type": "application/json"}


def _erro_http(status: int, corpo: str) -> ErroDoEnvio:
    """Classifica a recusa do motor (`routes/instances.ts`): 409 com «conectada»/«execução» é a
    instância fora do ar; 401/403 chave; 404 instância apagada; 5xx o motor. O resto é do contato."""
    texto = (corpo or "")[:300]
    with contextlib.suppress(Exception):  # corpo que não é JSON fica como veio
        texto = str((json.loads(corpo) or {}).get("error") or texto)[:300]
    baixo = texto.lower()
    if status in (401, 403):
        return ErroDoEnvio("O motor recusou a chave deste número — refaça a conexão em Canais", conta=True)
    if status == 404:
        return ErroDoEnvio("O motor não acha este número — reconecte em Canais", conta=True)
    if status == 409 and ("conectad" in baixo or "execu" in baixo):
        return ErroDoEnvio("O número está desconectado do WhatsApp — reconecte em Canais e retome", conta=True)
    if status >= 500:
        return ErroDoEnvio(f"O motor do WhatsApp falhou ({status}) — retome em alguns minutos", conta=True)
    return ErroDoEnvio(f"O motor recusou o envio: {texto or status}", conta=False)


async def conferir_numero(cfg: dict, numero: str) -> str | None:
    """O endereço do número no WhatsApp (`…@s.whatsapp.net`), ou None se não tem WhatsApp."""
    url, headers = _base(cfg)
    try:
        async with httpx.AsyncClient(timeout=20) as cli:
            r = await cli.post(f"{url}/on-whatsapp", json={"number": numero}, headers=headers)
    except httpx.HTTPError as e:
        raise ErroDoEnvio(
            f"O motor do WhatsApp não respondeu ({type(e).__name__}) — retome em alguns minutos", conta=True
        ) from e
    if r.status_code >= 400:
        raise _erro_http(r.status_code, r.text)
    d = r.json() if r.content else {}
    if not d.get("checked"):
        raise ErroDoEnvio("O número está desconectado do WhatsApp — reconecte em Canais e retome", conta=True)
    if not d.get("exists"):
        return None
    return str(d.get("jid") or f"{numero}@s.whatsapp.net")


async def _esperar(segundos: float) -> None:
    """Ponto único da pausa do «digitando…» (o teste troca)."""
    await asyncio.sleep(segundos)


async def enviar_texto(cfg: dict, jid: str, texto: str) -> dict:
    """«digitando…» e o texto. Devolve o que o motor respondeu (`{id, waMessageId}`)."""
    from services.connectors.base import ConnectorConfig, ConnectorError, OutboundMessage
    from services.connectors.registry import registry

    impl = registry.get(KIND)
    config = ConnectorConfig(data=cfg)
    try:
        await impl.send_typing(config, jid, "composing")
        await _esperar(random.uniform(*DIGITANDO_S))
    except Exception:  # noqa: BLE001 — o «digitando» é enfeite: sem ele o texto sai igual
        logger.debug("disparo qr: digitando falhou (segue)")
    try:
        return await impl.send(config, OutboundMessage(external_chat_id=jid, content=texto))
    except ConnectorError as e:
        corpo = str(e).split(": ", 1)[1] if ": " in str(e) else str(e)
        raise _erro_http(int(e.status_code or 0), corpo) from e
    except Exception as e:  # noqa: BLE001 — timeout/rede: pode ter saído; reenviar duplicaria
        raise ErroDoEnvio(SEM_CONFIRMACAO, conta=False) from e


# ───────────────────────── o envio de UM contato ─────────────────────────


async def gravar_na_conversa(
    db, conn, jid: str, texto: str, nome_disparo: str, wa_message_id: str | None, contact_name: str | None
) -> int:
    """Acha/abre a conversa do contato NAQUELE número e grava o envio. Mesmo jeito da resposta da
    família: no registro a conversa é do número (`por_numero`), no número com IA é do agente."""
    from services import agent_runtime

    registro = (getattr(conn, "modo", None) or "agente") == "registro"
    conv = await agent_runtime.ensure_conversation(
        db,
        agent_id=conn.agent_id,
        connector_kind=KIND,
        external_id=jid,
        contact_name=(contact_name or "").strip()[:120] or None,
        connector_id=conn.id,
        por_numero=registro,
    )
    db.add(
        TaMessageLog(
            conversation_id=conv.id,
            role="agent",
            content=(texto or "")[:8000],
            member_id=None,
            model_used=f"{MARCA_DISPARO} · {nome_disparo}"[:128],
            wa_message_id=(wa_message_id or None),
            wa_remote_jid=jid[:128],
            wa_from_me=True,
        )
    )
    conv.last_message_at = datetime.utcnow()
    await db.commit()
    return conv.id


async def enviar_um(
    db,
    *,
    tenant_id: int,
    conn,
    cfg: dict,
    numero: str,
    texto: str,
    nome_disparo: str,
    contact_name: str | None = None,
) -> dict:
    """Confere o número, envia e faz o que vem depois. Recusa → `ErroDoEnvio`. Falha ao gravar a
    conversa ou o status NÃO desfaz o envio: loga e segue (igual ao oficial)."""
    from services import proactive

    jid = await conferir_numero(cfg, numero)
    if jid is None:
        raise ErroDoEnvio(SEM_WHATSAPP, conta=False)
    res = await enviar_texto(cfg, jid, texto)
    wid = None
    if isinstance(res, dict) and res.get("waMessageId"):
        wid = str(res["waMessageId"])[:128]
    await proactive.marcar_eco_do_envio(db, conn, res)

    conversation_id = None
    try:
        conversation_id = await gravar_na_conversa(db, conn, jid, texto, nome_disparo, wid, contact_name)
    except Exception:  # noqa: BLE001 — o envio já saiu; a conversa é complemento
        logger.exception("disparo qr: enviado mas não entrou na conversa connector=%s", conn.id)
        await db.rollback()
    if wid:
        try:
            # SEM a conversa de propósito: o ciclo do histórico do card (crm_historico_whatsapp) pega
            # status COM conversa, e o CRM escreve esse histórico como «WhatsApp oficial» — o card
            # mostraria um envio do celular da consultora como se fosse do número oficial.
            await disparo_oficial.registrar_status(
                db,
                wamid=wid,
                status="accepted",
                tenant_id=tenant_id,
                connector_id=conn.id,
                destino=disparo_oficial.so_digitos(jid),
            )
        except Exception:  # noqa: BLE001
            logger.exception("disparo qr: status inicial não gravou wid=%s", wid)
            await db.rollback()
    return {"message_id": wid, "wa_id": jid[:32], "conversation_id": conversation_id}


# ───────────────────────── descadastro (resposta ao disparo) ─────────────────────────


async def descadastro_depois_do_disparo(
    db, conn, *, external_chat_id: str, sender_name: str | None, texto: str | None
) -> dict | None:
    """O contato pediu para parar depois de um disparo por este número? Grava na lista do tenant.

    None = não era pedido (segue o caminho de sempre) — e também no modo registro, onde a mensagem
    segue para o inbox da consultora: o sistema não responde pelo celular dela. No número com IA o
    contato recebe a confirmação UMA vez e a IA não é chamada neste turno (como no oficial).
    Nunca levanta: um erro aqui não pode derrubar a mensagem recebida."""
    if not disparo_oficial.eh_descadastro(texto, de_botao=False):
        return None
    try:
        ultima = (
            await db.execute(
                select(TaMessageLog.model_used)
                .join(TaConversation, TaConversation.id == TaMessageLog.conversation_id)
                .where(
                    TaConversation.connector_id == conn.id,
                    TaConversation.external_id == external_chat_id,
                    TaMessageLog.role.in_(("agent", "assistant")),
                )
                .order_by(TaMessageLog.id.desc())
                .limit(1)
            )
        ).first()
        if not ultima or not (ultima[0] or "").startswith(MARCA_DISPARO):
            return None
        agente = await db.get(TaAgent, conn.agent_id)
        if not agente:
            return None
        gravou = await disparo_oficial.registrar_descadastro(
            db, tenant_id=agente.tenant_id, connector_id=conn.id, numero=external_chat_id, texto=texto
        )
        logger.info("descadastro qr tenant=%s connector=%s gravou=%s", agente.tenant_id, conn.id, gravou)
        if (getattr(conn, "modo", None) or "agente") == "registro":
            return None
        return await _confirmar(db, conn, agente, external_chat_id, sender_name, texto or "")
    except Exception:  # noqa: BLE001
        logger.exception("descadastro qr falhou connector=%s", getattr(conn, "id", None))
        with contextlib.suppress(Exception):
            await db.rollback()
        return None


async def _confirmar(db, conn, agente, external_chat_id: str, sender_name: str | None, texto: str) -> dict:
    from core.encryption import decrypt
    from services import agent_runtime
    from services.connectors.base import ConnectorConfig, OutboundMessage
    from services.connectors.registry import registry

    conv = await agent_runtime.ensure_conversation(
        db,
        agent_id=agente.id,
        connector_kind=KIND,
        external_id=external_chat_id,
        contact_name=sender_name,
        connector_id=conn.id,
    )
    await agent_runtime.log_message(db, conversation_id=conv.id, tenant_id=agente.tenant_id, role="user", content=texto)
    confirmou = False
    try:
        cfg = ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc)))
        await registry.get(KIND).send(
            cfg, OutboundMessage(external_chat_id=external_chat_id, content=disparo_oficial.CONFIRMACAO_DESCADASTRO)
        )
        confirmou = True
    except Exception:  # noqa: BLE001
        logger.exception("descadastro qr: confirmação não saiu connector=%s", conn.id)
    if confirmou:
        await agent_runtime.log_message(
            db,
            conversation_id=conv.id,
            tenant_id=agente.tenant_id,
            role="assistant",
            content=disparo_oficial.CONFIRMACAO_DESCADASTRO,
        )
    return {"status": "descadastro", "confirmou": confirmou, "conversation_id": conv.id, "agent_id": agente.id}
