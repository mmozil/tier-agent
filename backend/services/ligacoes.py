"""Ligações pelo WhatsApp oficial (Calling API da Meta) — 14/11/2026.

Etapa 1: a FAMÍLIA liga para o número e a equipe atende pelo painel (navegador, WebRTC).

Fluxo:
  webhook `calls` (event=connect, USER_INITIATED, com a oferta SDP)
      → `ta_ligacao` estado «tocando» (+ conversa do contato garantida)
  painel (sondagem curta) vê a ligação tocando → «Atender»
      → o navegador monta a resposta SDP → POST /ligacoes/{id}/atender
      → Meta: pre_accept e accept com a MESMA resposta → estado «em_curso»
  webhook `calls` (event=terminate) → «encerrada» (com duração) · «perdida» · «recusada» · «falhou»

🚨 A ligação NÃO vira linha de `ta_message_log`: a IA monta o histórico, o follow-up olha «quem
falou por último» e as métricas contam mensagens daquela tabela — um registro de ligação ali mudaria
os três. A conversa mostra a ligação por montagem na leitura (`linhas_da_conversa`).

🚨 Atender é DISPUTA: dois atendentes podem clicar ao mesmo tempo. A troca «tocando → atendendo» é
um UPDATE condicional — quem perde recebe «já atendida».

Custo (rate card da Meta, 01/10/2026): ligação feita pela família é GRÁTIS. Ligação feita pela empresa
(etapa 2, exige permissão do contato) custa R$ 0,0556/min no Brasil, cobrada da conta do cliente.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import text as sa_text

logger = logging.getLogger(__name__)

# A Calling API é recente: usa versão nova da Graph, independente da v21 do resto do conector.
GRAPH_CALLS = "https://graph.facebook.com/v23.0"
_HTTP_TIMEOUT_S = 15.0

# «chamando» = a EMPRESA ligou e o contato ainda não atendeu (14/11/2026, ligar pelo WhatsApp).
ESTADOS_ATIVOS = ("tocando", "atendendo", "em_curso", "chamando")
# A Meta desiste da ligação feita pela empresa em ~60 s sem resposta.
CHAMANDO_VALE_S = 90
# Sem o aviso de encerramento (webhook perdido), «tocando» não pode ficar para sempre na tela: a Meta
# desiste em 30–60 s. Passou disso, a ligação não aparece mais como tocando.
TOCANDO_VALE_S = 75
# Em curso sem aviso de fim: some da barra depois de 3 h (ninguém fala 3 h numa visita escolar).
EM_CURSO_VALE = timedelta(hours=3)

DDL = (
    "CREATE TABLE IF NOT EXISTS ta_ligacao ("
    " id SERIAL PRIMARY KEY,"
    " call_id VARCHAR(200) NOT NULL,"
    " tenant_id INTEGER NOT NULL,"
    " connector_id INTEGER NOT NULL,"
    " conversation_id INTEGER,"
    " direcao VARCHAR(16) NOT NULL,"
    " contato VARCHAR(40),"
    " contato_nome VARCHAR(200),"
    " estado VARCHAR(16) NOT NULL,"
    " sdp_oferta TEXT,"
    " sdp_resposta TEXT,"
    " member_id INTEGER,"
    " atendida_por VARCHAR(120),"
    " criada_em TIMESTAMP NOT NULL DEFAULT now(),"
    " atendida_em TIMESTAMP,"
    " encerrada_em TIMESTAMP,"
    " duracao_s INTEGER,"
    " erro TEXT)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ta_ligacao_call_id ON ta_ligacao (call_id)",
    "CREATE INDEX IF NOT EXISTS ix_ta_ligacao_tenant_estado ON ta_ligacao (tenant_id, estado, criada_em)",
    "CREATE INDEX IF NOT EXISTS ix_ta_ligacao_conversa ON ta_ligacao (conversation_id)",
    # 14/11/2026 — gravação feita no NAVEGADOR (sem Meta): as duas vozes, com o aviso no começo.
    "ALTER TABLE ta_ligacao ADD COLUMN IF NOT EXISTS gravacao_url TEXT",
    "ALTER TABLE ta_ligacao ADD COLUMN IF NOT EXISTS gravacao_key TEXT",
    "ALTER TABLE ta_ligacao ADD COLUMN IF NOT EXISTS crm_ligacao_id INTEGER",
    # 14/11/2026 — quem gravou: «meta» (pedido no accept, vale para qualquer aba) ou «navegador».
    "ALTER TABLE ta_ligacao ADD COLUMN IF NOT EXISTS gravacao_por VARCHAR(16)",
    # 14/11/2026 — a linha do histórico do card já foi mandada ao CRM (mesmo sem gravação).
    "ALTER TABLE ta_ligacao ADD COLUMN IF NOT EXISTS crm_historico_em TIMESTAMP",
)


async def ligado_na_conta(db, tenant_id: int) -> bool:
    """Liga a sondagem curta do painel por CONTA: `ta_runtime_param` (escopo 'tenant', key
    'ligacoes_whatsapp', value '1'). Sem isso o painel pergunta a cada 60 s — as contas que não usam
    ligação não pagam a sondagem de 3 s."""
    v = (
        await db.execute(
            sa_text(
                "SELECT value FROM ta_runtime_param WHERE escopo = 'tenant' AND escopo_id = :t AND key = 'ligacoes_whatsapp'"
            ),
            {"t": tenant_id},
        )
    ).scalar()
    return str(v or "").strip() in ("1", "true", "sim")


# 🚨 14/11/2026 — a gravação feita pelo NAVEGADOR dependia da versão da aba: aba aberta antes da
# publicação atendia sem gravar (4 ligações do dono, nenhuma gravada). Agora o SERVIDOR pede a gravação
# no «accept» — vale para qualquer aba, velha ou nova. A Meta toca o aviso (em português) para as duas
# pontas, grava e avisa no webhook `calls` (event = call_recording_available); o áudio vem para o NOSSO
# armazenamento e segue para «Ligações QA» (transcrição e nota são nossas, não da Meta).
# 14/11/2026 (dono): a VOZ da Meta («o áudio será gravado para a seguinte finalidade…») SAI. Ela é obrigatória
# quando a Meta grava — então, por padrão, quem grava é o NAVEGADOR (sem aviso falado). A gravação da Meta só
# liga na conta que pedir: `ta_runtime_param` (escopo tenant, key `ligacoes_gravacao_meta`, value `1`).
async def gravacao_pela_meta(db, tenant_id: int) -> bool:
    v = (
        await db.execute(
            sa_text(
                "SELECT value FROM ta_runtime_param WHERE escopo = 'tenant' AND escopo_id = :t"
                " AND key = 'ligacoes_gravacao_meta'"
            ),
            {"t": tenant_id},
        )
    ).scalar()
    return str(v or "").strip() in ("1", "true", "sim")


GRAVACAO_META = {"status": "ENABLED", "purpose": "melhorar o nosso atendimento", "announcement_language": "pt"}


def audio_da_gravacao(call: dict) -> dict | None:
    """`calls[].call_recording.audio` do webhook (id, mime_type, url, sha256). Puro."""
    if str(call.get("event") or "").lower() != "call_recording_available":
        return None
    audio = ((call.get("call_recording") or {}).get("audio")) or {}
    return audio if audio.get("id") else None


_TAREFAS: set = set()


async def baixar_gravacao_meta(call_id: str, connector_id: int, audio: dict) -> None:
    """Em segundo plano: baixa a gravação da Meta (com o token do número), guarda e manda ao CRM."""
    import asyncio

    from core.db import SessionLocal
    from services.connectors.registry import registry as _reg
    from services.storage_service import storage

    try:
        async with SessionLocal() as db:
            lig = (
                await db.execute(
                    sa_text("SELECT id, tenant_id, gravacao_url FROM ta_ligacao WHERE call_id = :c"), {"c": call_id}
                )
            ).first()
            if not lig:
                logger.warning("gravação da Meta para ligação desconhecida call=%s", call_id)
                return
            if lig.gravacao_url:
                return
            _pnid, token = await _credenciais(db, connector_id)
            conteudo = await _reg.get("whatsapp_cloud").download_media(token, audio["id"])
            if not conteudo:
                logger.warning("gravação da Meta não baixou ligação=%s", lig.id)
                return
            mime = (audio.get("mime_type") or "audio/ogg").split(";")[0].strip()
            up = await asyncio.to_thread(
                storage.upload,
                conteudo,
                folder=f"ligacoes/{lig.tenant_id}",
                filename="gravacao.ogg",
                content_type=mime,
            )
            await db.execute(
                sa_text(
                    "UPDATE ta_ligacao SET gravacao_url = :u, gravacao_key = :k, gravacao_por = 'meta'"
                    " WHERE id = :i AND gravacao_url IS NULL"
                ),
                {"u": up.get("url"), "k": up.get("key"), "i": lig.id},
            )
            await db.commit()
            logger.info("ligação %s: gravação da Meta guardada (%s bytes)", lig.id, len(conteudo))
        await mandar_para_o_crm(lig.id)
    except Exception:  # noqa: BLE001
        logger.exception("gravação da Meta falhou call=%s", call_id)


def _quando(ts) -> datetime | None:
    try:
        return datetime.utcfromtimestamp(int(ts))
    except (TypeError, ValueError):
        return None


def _erro_de(call: dict) -> str | None:
    erros = call.get("errors") or []
    e0 = erros[0] if erros and isinstance(erros[0], dict) else {}
    if not e0:
        return None
    det = ((e0.get("error_data") or {}).get("details")) or ""
    return " · ".join(str(x) for x in (e0.get("code"), e0.get("message") or e0.get("title"), det) if x)[:500]


def estado_final(atual: str | None, call: dict) -> str:
    """Estado depois do aviso de encerramento. Puro (testável).

    COMPLETED com duração = conversa aconteceu · COMPLETED sem duração = ninguém atendeu (ou foi
    recusada por nós — aí o «recusada» que gravamos fica) · FAILED = falhou."""
    status = str(call.get("status") or "").upper()
    if status == "FAILED":
        return "falhou"
    if call.get("duration") not in (None, "", 0, "0") or call.get("start_time"):
        return "encerrada"
    if atual == "recusada":
        return "recusada"
    return "perdida"


async def registrar_evento_de_chamada(db, phone_number_id: str | None, value: dict) -> int:
    """`value.calls` do webhook da Cloud. Um item com defeito não derruba os outros. Devolve quantos gravou."""
    from models import TaConnector
    from services import agent_runtime
    from services.disparo_oficial import conector_do_numero

    alvo = await conector_do_numero(db, phone_number_id)
    if not alvo:
        return 0
    connector_id, tenant_id = alvo
    contatos = value.get("contacts") or []
    nome_por_wa = {
        str(c.get("wa_id") or ""): ((c.get("profile") or {}).get("name") or None)
        for c in contatos
        if isinstance(c, dict)
    }
    n = 0
    for call in value.get("calls") or []:
        if not isinstance(call, dict) or not call.get("id"):
            continue
        try:
            evento = str(call.get("event") or "").lower()
            direcao = "entrada" if str(call.get("direction") or "").upper() != "BUSINESS_INITIATED" else "saida"
            if evento == "connect" and direcao == "entrada":
                contato = str(call.get("from") or "")
                nome = nome_por_wa.get(contato) or (next(iter(nome_por_wa.values())) if len(nome_por_wa) == 1 else None)
                conv_id = None
                conn = await db.get(TaConnector, connector_id)
                if conn and contato:
                    try:
                        conv = await agent_runtime.ensure_conversation(
                            db,
                            agent_id=conn.agent_id,
                            connector_kind="whatsapp_cloud",
                            external_id=contato,
                            contact_name=nome,
                            connector_id=connector_id,
                            por_numero=True,
                        )
                        conv_id = conv.id
                    except Exception:  # noqa: BLE001 — a ligação toca mesmo sem a conversa
                        logger.exception("ligação: conversa não garantida call=%s", call.get("id"))
                        await db.rollback()
                sessao = call.get("session") or {}
                r = await db.execute(
                    sa_text(
                        "INSERT INTO ta_ligacao (call_id, tenant_id, connector_id, conversation_id, direcao, contato,"
                        " contato_nome, estado, sdp_oferta, criada_em)"
                        " VALUES (:cid, :t, :c, :conv, 'entrada', :de, :nome, 'tocando', :sdp, COALESCE(:em, now()))"
                        " ON CONFLICT (call_id) DO NOTHING"
                    ),
                    {
                        "cid": call["id"],
                        "t": tenant_id,
                        "c": connector_id,
                        "conv": conv_id,
                        "de": contato[:40],
                        "nome": (nome or "")[:200] or None,
                        "sdp": sessao.get("sdp"),
                        "em": _quando(call.get("timestamp")),
                    },
                )
                await db.commit()
                n += r.rowcount or 0
            elif evento == "connect" and direcao == "saida":
                # Etapa 2 (a empresa liga): a Meta devolve a RESPOSTA SDP do contato.
                sessao = call.get("session") or {}
                await db.execute(
                    sa_text("UPDATE ta_ligacao SET sdp_resposta = :sdp WHERE call_id = :cid"),
                    {"sdp": sessao.get("sdp"), "cid": call["id"]},
                )
                await db.commit()
                n += 1
            elif evento == "call_recording_available":
                audio = audio_da_gravacao(call)
                if audio:
                    import asyncio

                    t = asyncio.create_task(baixar_gravacao_meta(call["id"], connector_id, audio))
                    _TAREFAS.add(t)
                    t.add_done_callback(_TAREFAS.discard)
                    n += 1
            elif evento == "terminate":
                atual = (
                    await db.execute(sa_text("SELECT estado FROM ta_ligacao WHERE call_id = :cid"), {"cid": call["id"]})
                ).scalar()
                if atual is None:
                    continue
                dur = call.get("duration")
                final = estado_final(atual, call)
                await db.execute(
                    sa_text(
                        "UPDATE ta_ligacao SET estado = :e, encerrada_em = COALESCE(:fim, now()),"
                        " duracao_s = COALESCE(:dur, duracao_s), erro = COALESCE(:erro, erro),"
                        " atendida_em = COALESCE(atendida_em, :ini) WHERE call_id = :cid"
                    ),
                    {
                        "e": final,
                        "fim": _quando(call.get("end_time")) or _quando(call.get("timestamp")),
                        "dur": int(dur) if str(dur or "").isdigit() else None,
                        "erro": _erro_de(call),
                        "ini": _quando(call.get("start_time")),
                        "cid": call["id"],
                    },
                )
                await db.commit()
                n += 1
                lid = (
                    await db.execute(sa_text("SELECT id FROM ta_ligacao WHERE call_id = :c"), {"c": call["id"]})
                ).scalar()
                if lid:
                    import asyncio

                    # Perdida/recusada: a linha vai já. Atendida: espera a gravação (4 min) e, se ela não vier,
                    # manda a linha do histórico assim mesmo — a ligação nunca some do card.
                    t = asyncio.create_task(
                        mandar_para_o_crm(lid, sem_audio_ok=True, esperar_s=0 if final != "encerrada" else 240)
                    )
                    _TAREFAS.add(t)
                    t.add_done_callback(_TAREFAS.discard)
        except Exception:  # noqa: BLE001
            logger.exception("evento de ligação falhou call=%s", call.get("id"))
            await db.rollback()
    return n


async def registrar_status_de_chamada(db, statuses: list) -> int:
    """`value.statuses` com `type: "call"` (RINGING · ACCEPTED · REJECTED da ligação feita pela empresa).
    Não vão para os tiques de mensagem (`ta_wa_envio_status`)."""
    # RINGING de ligação que a EMPRESA fez continua «chamando» (o painel não confunde com ligação entrando).
    mapa = {"RINGING": "chamando", "ACCEPTED": "em_curso", "REJECTED": "recusada"}
    n = 0
    for s in statuses or []:
        e = mapa.get(str(s.get("status") or "").upper())
        if not e or not s.get("id"):
            continue
        try:
            # 🚨 15/11/2026 — o mesmo parâmetro (:e) no SET e no CASE dava AmbiguousParameterError no asyncpg:
            # o «atendeu» da ligação feita pela empresa nunca gravava, o painel ficava em «chamando», o microfone
            # fechado (o contato não ouvia) e nada era gravado. Um parâmetro por papel.
            await db.execute(
                sa_text(
                    "UPDATE ta_ligacao SET estado = :e,"
                    " atendida_em = CASE WHEN :atendeu THEN COALESCE(atendida_em, now()) ELSE atendida_em END"
                    " WHERE call_id = :cid AND estado NOT IN ('encerrada', 'perdida', 'recusada', 'falhou')"
                ),
                {"e": e, "atendeu": e == "em_curso", "cid": s["id"]},
            )
            await db.commit()
            n += 1
        except Exception:  # noqa: BLE001
            logger.exception("status de ligação falhou call=%s", s.get("id"))
            await db.rollback()
    return n


def separar_statuses(statuses: list) -> tuple[list, list]:
    """(de mensagem, de ligação). Puro."""
    msg, lig = [], []
    for s in statuses or []:
        (lig if isinstance(s, dict) and str(s.get("type") or "").lower() == "call" else msg).append(s)
    return msg, lig


# ── ações na Meta ────────────────────────────────────────────────────────────────────────────


async def _credenciais(db, connector_id: int) -> tuple[str, str]:
    from core.encryption import decrypt
    from models import TaConnector
    from services.connectors.adapters.whatsapp_cloud import resolve_cloud_creds
    from services.connectors.base import ConnectorConfig

    conn = await db.get(TaConnector, connector_id)
    if not conn:
        raise RuntimeError("número não encontrado")
    pnid, token = resolve_cloud_creds(ConnectorConfig(data=json.loads(decrypt(conn.config_json_enc))))
    if not pnid or not token:
        raise RuntimeError("número sem credencial")
    return pnid, token


async def acao_na_meta(db, connector_id: int, corpo: dict) -> dict:
    """POST /{phone_number_id}/calls. Erro da Meta vira RuntimeError com a mensagem dela."""
    pnid, token = await _credenciais(db, connector_id)
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
        r = await cli.post(
            f"{GRAPH_CALLS}/{pnid}/calls",
            headers={"Authorization": f"Bearer {token}"},
            json={"messaging_product": "whatsapp", **corpo},
        )
    try:
        j = r.json()
    except Exception:  # noqa: BLE001
        j = {}
    if r.status_code >= 400:
        err = j.get("error") or {}
        msg = err.get("error_user_msg") or err.get("message") or r.text[:200]
        raise RuntimeError(f"{err.get('code') or r.status_code}: {msg}")
    return j


# ── a EMPRESA liga pelo WhatsApp (14/11/2026) ──────────────────────────────────────────────
# Pedido do dono: o «Ligar» do CRM e do Agent sai pelo WhatsApp oficial (por enquanto, no lugar da telefonia).
# A Meta só completa ligação para quem deu PERMISSÃO (pedido na conversa: 1 a cada 24 h, 2 em 7 dias).


def numero_br(bruto: str | None) -> str:
    """Só dígitos, com 55 na frente quando vier com DDD e sem país. Puro."""
    d = "".join(ch for ch in str(bruto or "") if ch.isdigit())
    if len(d) in (10, 11):
        d = "55" + d
    return d


def sem_permissao(erro: str) -> bool:
    """A Meta recusou porque o contato não autorizou ligação (138006). Puro."""
    t = str(erro or "")
    return "138006" in t or ("permission" in t.lower() and "call" in t.lower())


async def pedir_permissao(db, connector_id: int, numero: str) -> dict:
    """Manda o pedido oficial de permissão de ligação (mensagem interativa da Meta). Só dentro da janela de
    24 h da conversa; fora dela a Meta recusa (131047) e o motivo volta para a tela."""
    pnid, token = await _credenciais(db, connector_id)
    corpo = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": numero,
        "type": "interactive",
        "interactive": {
            "type": "call_permission_request",
            "action": {"name": "call_permission_request"},
            "body": {"text": "Podemos te ligar por aqui, pelo WhatsApp?"},
        },
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
        r = await cli.post(f"{GRAPH_CALLS}/{pnid}/messages", headers={"Authorization": f"Bearer {token}"}, json=corpo)
    if r.status_code >= 400:
        return {"ok": False, "motivo": _motivo_meta(r)}
    return {"ok": True, "motivo": None}


# ── ligar/desligar no número (14/11/2026) ─────────────────────────────────────────────────
# Decisão do dono: número oficial CADASTRADO já nasce com ligação ligada; a chave «Receber ligações»
# na tela do número desliga depois. Ligar = a Meta mostra o botão de ligar para TODOS os contatos do
# número, e a conta passa a sondar ligação a cada 3 s (o interruptor da conta, `ligacoes_whatsapp`).


def _motivo_meta(r: httpx.Response) -> str:
    try:
        err = (r.json() or {}).get("error") or {}
    except Exception:  # noqa: BLE001
        err = {}
    msg = err.get("error_user_msg") or err.get("message") or (r.text or "")[:200]
    return f"{err.get('code') or r.status_code}: {msg}"[:300]


async def estado_na_meta(pnid: str, token: str) -> dict:
    """Como a Meta está agora para este número. `ligado` = ligações ENABLED."""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
        r = await cli.get(f"{GRAPH_CALLS}/{pnid}/settings", headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        return {"ligado": False, "estado": "desconhecido", "motivo": _motivo_meta(r)}
    c = (r.json() or {}).get("calling") or {}
    return {
        "ligado": str(c.get("status") or "").upper() == "ENABLED",
        "estado": c.get("status") or "NOT_SET",
        "botao_visivel": str(c.get("call_icon_visibility") or "").upper() != "DISABLE_ALL",
    }


async def mudar_na_meta(pnid: str, token: str, ligado: bool) -> dict:
    """Liga (com o botão de ligar visível) ou desliga. Devolve {ok, motivo}: a Meta recusa quando o número
    não cumpre os requisitos (limite de 2.000 contatos/dia, conta, webhook) — o motivo dela vai para a tela."""
    corpo = (
        {"calling": {"status": "ENABLED", "call_icon_visibility": "DEFAULT"}}
        if ligado
        else {"calling": {"status": "DISABLED"}}
    )
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as cli:
        r = await cli.post(f"{GRAPH_CALLS}/{pnid}/settings", headers={"Authorization": f"Bearer {token}"}, json=corpo)
    if r.status_code >= 400:
        return {"ok": False, "motivo": _motivo_meta(r)}
    return {"ok": True, "motivo": None}


async def acertar_interruptor_da_conta(db, tenant_id: int) -> bool:
    """A conta sonda ligação (3 s) se ALGUM número dela está com ligação ligada na Meta. Devolve o valor."""
    from sqlalchemy import select

    from core.encryption import decrypt
    from models import TaAgent, TaConnector
    from services.connectors.adapters.whatsapp_cloud import resolve_cloud_creds
    from services.connectors.base import ConnectorConfig

    conns = (
        (
            await db.execute(
                select(TaConnector)
                .join(TaAgent, TaAgent.id == TaConnector.agent_id)
                .where(
                    TaAgent.tenant_id == tenant_id, TaConnector.kind == "whatsapp_cloud", TaConnector.enabled.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    algum = False
    for c in conns:
        try:
            pnid, token = resolve_cloud_creds(ConnectorConfig(data=json.loads(decrypt(c.config_json_enc))))
            if pnid and token and (await estado_na_meta(pnid, token)).get("ligado"):
                algum = True
                break
        except Exception:  # noqa: BLE001
            logger.warning("interruptor de ligações: número %s não lido", c.id, exc_info=True)
    await db.execute(
        sa_text(
            "INSERT INTO ta_runtime_param (escopo, escopo_id, key, value) VALUES ('tenant', :t, 'ligacoes_whatsapp', :v)"
            " ON CONFLICT (escopo, escopo_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
        ),
        {"t": tenant_id, "v": "1" if algum else "0"},
    )
    await db.commit()
    return algum


async def ligar_no_cadastro(db, connector_id: int, tenant_id: int) -> dict:
    """Chamado ao conectar o número oficial. NUNCA derruba o cadastro: falha vira motivo no log."""
    try:
        pnid, token = await _credenciais(db, connector_id)
        res = await mudar_na_meta(pnid, token, True)
        if res["ok"]:
            await acertar_interruptor_da_conta(db, tenant_id)
        else:
            logger.warning("ligações não ligadas no cadastro conector=%s: %s", connector_id, res["motivo"])
        return res
    except Exception as e:  # noqa: BLE001
        logger.exception("ligações no cadastro falharam conector=%s", connector_id)
        return {"ok": False, "motivo": str(e)[:300]}


# ── gravação (navegador → R2 → CRM «Ligações QA») ──────────────────────────────────────────

LIMITE_GRAVACAO_BYTES = 80 * 1024 * 1024  # ~2 h a 64 kbit/s


async def mandar_para_o_crm(ligacao_id: int, sem_audio_ok: bool = False, esperar_s: int = 0) -> None:
    """Em segundo plano: a ligação vai para o CRM — linha no HISTÓRICO DO CARD do contato e, se gravada, a página
    «Ligações QA» (transcrição + nota pelo roteiro). `sem_audio_ok`: manda só a linha do histórico (perdida,
    recusada, ou atendida cuja gravação não chegou). `esperar_s`: dá tempo de a gravação chegar antes.
    Falha aqui não perde nada: o áudio já está guardado e a conversa já toca a gravação."""
    if esperar_s:
        import asyncio

        await asyncio.sleep(esperar_s)
    from core.db import SessionLocal
    from services import erp_crm_client

    try:
        async with SessionLocal() as db:
            r = (
                await db.execute(
                    sa_text(
                        "SELECT l.id, l.tenant_id, l.contato, l.atendida_por, l.duracao_s, l.gravacao_url, l.direcao,"
                        " l.crm_ligacao_id, l.crm_historico_em, l.estado, l.criada_em, m.nome AS membro"
                        " FROM ta_ligacao l LEFT JOIN ta_member m ON m.id = l.member_id WHERE l.id = :i"
                    ),
                    {"i": ligacao_id},
                )
            ).first()
            if not r or r.crm_ligacao_id or r.estado in ESTADOS_ATIVOS:
                return  # já foi com a gravação, ou ainda está em andamento
            audio = r.gravacao_url if str(r.gravacao_url or "").startswith("https://") else None
            if not audio and (not sem_audio_ok or r.crm_historico_em):
                return  # sem gravação: só manda a linha do histórico uma vez, e só quando pedido
            resp = await erp_crm_client.enviar_ligacao_whatsapp(
                agent_tenant_id=r.tenant_id,
                external_id=f"wa-agent-{r.id}",
                audio_url=audio,
                direcao="in" if r.direcao == "entrada" else "out",
                numero=r.contato,
                atendente_nome=r.membro or r.atendida_por,
                duracao_seg=r.duracao_s,
                estado=r.estado,
                em=(r.criada_em.isoformat() + "Z") if r.criada_em else None,
            )
            crm_id = (resp or {}).get("id")
            await db.execute(
                sa_text(
                    "UPDATE ta_ligacao SET crm_ligacao_id = COALESCE(:c, crm_ligacao_id), crm_historico_em = now()"
                    " WHERE id = :i"
                ),
                {"c": int(crm_id) if crm_id else None, "i": ligacao_id},
            )
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("ligação %s: envio ao CRM falhou", ligacao_id)


# ── leitura para o painel ────────────────────────────────────────────────────────────────────


def _rotulo(estado: str, direcao: str, duracao_s: int | None, quem: str | None) -> str:
    if estado == "chamando":
        return "📞 Chamando…"
    """Linha da conversa. Puro."""
    sentido = "recebida" if direcao == "entrada" else "feita"
    if estado == "encerrada":
        m, s = divmod(int(duracao_s or 0), 60)
        tempo = f"{m} min {s:02d} s" if m else f"{s} s"
        return f"📞 Ligação {sentido} · {tempo}" + (f" · atendida por {quem}" if quem and direcao == "entrada" else "")
    if estado == "perdida":
        return "📞 Ligação perdida" if direcao == "entrada" else "📞 Ligação não atendida"
    if estado == "recusada":
        return "📞 Ligação recusada"
    if estado == "falhou":
        return "📞 Ligação não completada"
    if estado == "tocando":
        return "📞 Ligação tocando…"
    return "📞 Ligação em andamento" + (f" · {quem}" if quem else "")


async def linhas_da_conversa(db, conversation_id: int) -> list[dict]:
    """Ligações da conversa no formato das mensagens (id NEGATIVO, role «ligacao»). Só leitura."""
    rows = (
        await db.execute(
            sa_text(
                "SELECT id, direcao, estado, duracao_s, atendida_por, criada_em, erro, gravacao_url FROM ta_ligacao"
                " WHERE conversation_id = :c ORDER BY criada_em"
            ),
            {"c": conversation_id},
        )
    ).all()
    return [
        {
            "id": -int(r.id),
            "role": "ligacao",
            "content": _rotulo(r.estado, r.direcao, r.duracao_s, r.atendida_por),
            "created_at": r.criada_em,
            # Gravação = o mesmo player de áudio das mensagens.
            "attachments_json": [{"kind": "audio", "url": r.gravacao_url, "mime": "audio/webm"}]
            if r.gravacao_url
            else None,
        }
        for r in rows
    ]
