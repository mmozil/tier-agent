"""Webhooks inbound — Tier WhatsApp Engine, Telegram, etc.

Cada webhook valida assinatura/secret, faz idempotency via TaWebhookEvent,
encaminha pra agent_runtime via tier_engine.
"""

import hashlib
import hmac
import logging
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db
from models import (
    TaConnector,
    TaPlaybook,
    TaPlaybookTriggerIndex,
    TaWebhookEvent,
)
from services import playbook_executor

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_tier_signature(body: bytes, signature: str | None) -> bool:
    if not settings.tier_whatsapp_webhook_secret or not signature:
        return False
    expected = hmac.new(
        settings.tier_whatsapp_webhook_secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    sig_clean = signature.replace("sha256=", "")
    return hmac.compare_digest(expected, sig_clean)


async def _record_idempotent(
    db: AsyncSession, source: str, event_id: str, payload: dict
) -> bool:
    """Retorna True se evento já foi processado (skip)."""
    existing = await db.execute(
        select(TaWebhookEvent).where(
            TaWebhookEvent.source == source, TaWebhookEvent.event_id == event_id
        )
    )
    if existing.scalar_one_or_none():
        return True
    db.add(TaWebhookEvent(source=source, event_id=event_id, payload_json=payload))
    await db.commit()
    return False


@router.post("/whatsapp-engine")
async def whatsapp_engine_webhook(
    request: Request,
    x_tier_signature: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Recebe eventos do Tier WhatsApp Engine.

    Payload esperado (de tier-whatsapp-engine/src/services/webhook-dispatcher.ts):
    { instanceId, tenantId, event, payload, ts }
    """
    body = await request.body()
    if not _verify_tier_signature(body, x_tier_signature):
        raise HTTPException(401, "Assinatura inválida")

    data = await request.json()
    # event_id ÚNICO por mensagem. A Engine manda o payload com `instance_id`/
    # `timestamp` (snake_case) + o evento Baileys em `data`. O código antigo lia
    # `instanceId`/`ts` (que NÃO existem) → event_id virava "None-None-messages.upsert"
    # constante → TODA mensagem após a 1ª era tratada como duplicata e ignorada.
    # Agora usa o waMessageId real (key.id), com fallbacks robustos.
    _inst = data.get("instance_id") or data.get("instanceId")
    _ts = data.get("timestamp") or data.get("ts")
    _inner = data.get("data") or data.get("payload") or {}
    _msg_id = (_inner.get("key") or {}).get("id") if isinstance(_inner, dict) else None
    event_id = data.get("id") or _msg_id or f"{_inst}-{_ts}-{data.get('event')}"

    if await _record_idempotent(db, "whatsapp-engine", event_id, data):
        return {"status": "duplicate", "skipped": True}

    # Webhook Engine moderno usa `instance_id` + `data` (worker); legado/dev usam `instanceId` + `payload`
    instance_id = data.get("instance_id") or data.get("instanceId")
    event = data.get("event")
    payload = data.get("data") or data.get("payload") or {}

    # Aceita formato Baileys real (messages.upsert) + formato legado (message/message.text)
    if event not in {"messages.upsert", "message", "message.text"}:
        logger.debug("ignorando event %s", event)
        return {"status": "ignored", "event": event}

    # Ignora mensagens enviadas POR NÓS (fromMe=true) — só processa inbound
    key = payload.get("key") or {}
    if key.get("fromMe"):
        return {"status": "ignored", "reason": "from_me"}

    from services import agent_runtime
    from services.connectors.base import ConnectorAttachment

    # Extrai texto + attachments do payload Baileys
    text_content = ""
    attachments: list[ConnectorAttachment] = []

    msg = payload.get("message") or {}
    media_url = payload.get("mediaUrl")  # URL R2 pública (pre-uploaded pelo Engine)

    # Texto puro (conversation) ou caption de mídia
    if isinstance(msg, dict):
        if msg.get("conversation"):
            text_content = msg["conversation"]
        elif msg.get("extendedTextMessage"):
            text_content = msg["extendedTextMessage"].get("text") or ""
        elif msg.get("imageMessage"):
            text_content = msg["imageMessage"].get("caption") or ""
            if media_url:
                attachments.append(
                    ConnectorAttachment(
                        kind="image",
                        url=media_url,
                        mime=msg["imageMessage"].get("mimetype") or "image/jpeg",
                    )
                )
        elif msg.get("videoMessage"):
            text_content = msg["videoMessage"].get("caption") or ""
            if media_url:
                attachments.append(
                    ConnectorAttachment(kind="video", url=media_url, mime=msg["videoMessage"].get("mimetype"))
                )
        elif msg.get("audioMessage"):
            if media_url:
                attachments.append(
                    ConnectorAttachment(kind="audio", url=media_url, mime=msg["audioMessage"].get("mimetype"))
                )
        elif msg.get("documentMessage"):
            text_content = msg["documentMessage"].get("caption") or ""
            if media_url:
                attachments.append(
                    ConnectorAttachment(kind="document", url=media_url, mime=msg["documentMessage"].get("mimetype"))
                )

    # Fallback: formato legado/dev (payload.text/body)
    if not text_content and not attachments:
        text_content = payload.get("text") or payload.get("body") or ""

    # External chat id — preferir resolvedPhoneJid (LID → phone), fallback remoteJid
    external_chat_id = (
        payload.get("resolvedPhoneJid")
        or key.get("remoteJid")
        or payload.get("from")
        or payload.get("chat_id")
        or ""
    )
    sender_name = payload.get("pushName") or payload.get("sender_name") or payload.get("notifyName")

    if not external_chat_id:
        return {"status": "missing_fields", "event": event}

    # Q2.3: ASR — se inbound é áudio sem texto, transcrever via Deepgram PT-BR
    audio_att = next((a for a in attachments if a.kind == "audio" and a.url), None)
    if audio_att and not text_content:
        try:
            from services.voice import deepgram_client

            tr = await deepgram_client.transcribe_url(audio_att.url, language="pt-BR")
            if tr.ok and tr.text:
                text_content = tr.text
                logger.info(
                    "voice ASR ok confidence=%.2f duration=%.1fs text='%s'",
                    tr.confidence, tr.duration_seconds, tr.text[:80],
                )
            else:
                logger.warning("voice ASR falhou: %s", tr.error or "vazio")
                text_content = "[áudio — transcrição falhou]"
        except Exception:
            logger.exception("voice ASR exception")
            text_content = "[áudio]"

    # Permite mensagem só com mídia (sem texto) — placeholder
    if not text_content and attachments:
        text_content = f"[{attachments[0].kind}]"

    result = await agent_runtime.handle_inbound_message(
        db,
        connector_kind="whatsapp",
        instance_id=instance_id,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
        text_content=text_content,
        attachments=attachments,
    )
    logger.info(
        "webhook WhatsApp processed: agent=%s status=%s attachments=%s",
        result.get("agent_id"), result.get("status"), len(attachments),
    )
    return result


# ============================================================
# WhatsApp Cloud API (oficial Meta) webhook inbound
# ============================================================
@router.get("/whatsapp-cloud")
async def whatsapp_cloud_verify(request: Request):
    """Handshake de verificação do Meta (GET hub.mode=subscribe + verify_token + challenge)."""
    import os as _os

    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    expected = _os.environ.get("WHATSAPP_CLOUD_VERIFY_TOKEN")
    if mode == "subscribe" and expected and token == expected and challenge:
        return int(challenge) if challenge.isdigit() else challenge
    raise HTTPException(403, "Verify token mismatch")


def _verify_meta_signature(body: bytes, signature: str | None) -> bool:
    """Valida HMAC SHA-256 do body com o App Secret (header X-Hub-Signature-256).
    Se WHATSAPP_CLOUD_APP_SECRET não estiver setado, não bloqueia (dev/setup)."""
    import os as _os

    # Aceita múltiplos app secrets: o app de produção (Embedded Signup) +
    # o app legado (teste Tier 92336). Cada app assina com o secret dele.
    secrets = [
        _os.environ.get("WHATSAPP_CLOUD_APP_SECRET"),
        _os.environ.get("WHATSAPP_CLOUD_APP_SECRET_LEGACY"),
    ]
    secrets = [s for s in secrets if s]
    if not secrets:
        return True  # sem secret configurado → não valida (permite setup inicial)
    if not signature:
        return False
    for secret in secrets:
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature):
            return True
    return False


# ── Timing humanizado (WhatsApp Cloud) ──────────────────────────────
# Responder no mesmo instante (tique + "digitando…" imediatos) entrega que é
# bot. Aqui damos um atraso de leitura curto antes de ler/digitar; o tempo de
# geração do agente já funciona como "tempo de digitação". Faixa ajustável.
_CLOUD_READ_DELAY_MIN = 2.0  # segundos
_CLOUD_READ_DELAY_MAX = 3.2  # segundos
_BG_TASKS: set = set()


async def _process_cloud_message_humanized(
    *,
    phone_number_id: str | None,
    mid: str,
    from_id: str,
    sender_name: str | None,
    text_content: str,
    attachments: list,
) -> None:
    """Processa 1 mensagem inbound do WhatsApp Cloud com timing humano.

    Roda em background (asyncio.create_task) pra não segurar o 200 do webhook:
    1. espera um intervalo curto (leitura) — não responde no mesmo instante
    2. marca como lido + "digitando…"
    3. o agente gera a resposta (a latência do LLM já é o tempo de digitação)
    4. envia
    """
    import asyncio
    import json as _json
    import random

    from core.db import db_context
    from core.encryption import decrypt
    from services import agent_runtime
    from services.connectors.base import ConnectorConfig
    from services.connectors.registry import registry as _reg

    try:
        # 1. atraso de leitura — não responder no mesmo instante
        await asyncio.sleep(random.uniform(_CLOUD_READ_DELAY_MIN, _CLOUD_READ_DELAY_MAX))

        async with db_context() as db:
            # 2. marca lido + "digitando…"
            try:
                conn = await agent_runtime.resolve_connector_by_instance(
                    db, "whatsapp_cloud", phone_number_id
                )
                if conn:
                    cloud = _reg.get("whatsapp_cloud")
                    cfg = ConnectorConfig(data=_json.loads(decrypt(conn.config_json_enc)))
                    await cloud.mark_read_and_typing(cfg, mid)
            except Exception:
                logger.debug("typing indicator whatsapp-cloud falhou (ignorando)")

            # 3+4. gera e envia (latência do LLM = tempo de digitação percebido)
            await agent_runtime.handle_inbound_message(
                db,
                connector_kind="whatsapp_cloud",
                instance_id=phone_number_id,
                external_chat_id=from_id,
                sender_name=sender_name,
                text_content=text_content,
                attachments=attachments,
            )
    except Exception:
        logger.exception("processamento humanizado whatsapp-cloud falhou from=%s", from_id)


@router.post("/whatsapp-cloud")
async def whatsapp_cloud_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Recebe mensagens da WhatsApp Cloud API (Meta).

    Payload Meta:
    { object: "whatsapp_business_account",
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id }, contacts: [{profile:{name}, wa_id}],
        messages: [{ from, id, type, text:{body} | image/audio/document:{id,caption} }]
      }}]}]}
    """
    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256")
    if not _verify_meta_signature(body, sig):
        raise HTTPException(401, "Assinatura inválida")

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")

    if data.get("object") != "whatsapp_business_account":
        return {"status": "ignored", "reason": "not_waba_object"}

    from services import agent_runtime
    from services.connectors.base import ConnectorAttachment, ConnectorConfig

    results = []
    for entry in data.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = metadata.get("phone_number_id")
            contacts = value.get("contacts") or []
            sender_name = (
                (contacts[0].get("profile") or {}).get("name") if contacts else None
            )

            for m in value.get("messages") or []:
                from_id = m.get("from")
                mid = m.get("id") or ""
                if not from_id or not mid:
                    continue
                if await _record_idempotent(db, "whatsapp-cloud", mid, m):
                    continue

                mtype = m.get("type")
                text_content = ""
                attachments: list[ConnectorAttachment] = []

                if mtype == "text":
                    text_content = (m.get("text") or {}).get("body") or ""
                elif mtype == "interactive":
                    inter = m.get("interactive") or {}
                    br = inter.get("button_reply") or inter.get("list_reply") or {}
                    text_content = br.get("title") or br.get("id") or ""
                elif mtype == "button":
                    text_content = (m.get("button") or {}).get("text") or ""
                elif mtype in ("image", "audio", "video", "document"):
                    media = m.get(mtype) or {}
                    text_content = media.get("caption") or ""
                    # mídia recebida tem só `id` — baixar exige token; tratado como
                    # follow-up (por ora placeholder pra não travar o fluxo de texto)
                    if not text_content:
                        text_content = f"[{mtype}]"

                if not text_content:
                    text_content = f"[{mtype or 'mensagem'}]"

                # Processa em background com timing humanizado (atraso de leitura
                # + digitar), pra não responder no mesmo instante. O webhook
                # devolve 200 já; a idempotência acima evita reprocessar retries.
                import asyncio as _asyncio

                _task = _asyncio.create_task(
                    _process_cloud_message_humanized(
                        phone_number_id=phone_number_id,
                        mid=mid,
                        from_id=from_id,
                        sender_name=sender_name,
                        text_content=text_content,
                        attachments=attachments,
                    )
                )
                _BG_TASKS.add(_task)
                _task.add_done_callback(_BG_TASKS.discard)
                results.append({"from": from_id, "status": "accepted"})

    logger.info("webhook whatsapp-cloud processed events=%s", len(results))
    return {"status": "ok", "processed": results}


# ============================================================
# Telegram Bot API webhook inbound
# ============================================================
@router.post("/telegram/{bot_id}")
async def telegram_webhook(
    bot_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Recebe update do Telegram Bot API.

    Cliente configurou setWebhook → POST /webhooks/telegram/{bot_id} com Update JSON.
    {update_id, message: {chat: {id}, text, from: {first_name}, voice?, photo?}}
    """
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")

    event_id = str(data.get("update_id") or "")
    if not event_id:
        return {"status": "no_update_id"}
    if await _record_idempotent(db, f"telegram:{bot_id}", event_id, data):
        return {"status": "duplicate"}

    msg = data.get("message") or data.get("edited_message") or {}
    chat = msg.get("chat") or {}
    chat_id = str(chat.get("id") or "")
    if not chat_id:
        return {"status": "ignored", "reason": "no_chat_id"}

    sender_name = (msg.get("from") or {}).get("first_name") or (msg.get("from") or {}).get("username")

    from services import agent_runtime
    from services.connectors.base import ConnectorAttachment

    text_content = (msg.get("text") or msg.get("caption") or "").strip()
    attachments: list[ConnectorAttachment] = []

    # Telegram getFile resolver — extrai file_id de voice/photo/document/video,
    # chama getFile API pra resolver file_path, monta URL pública Telegram CDN
    # (https://api.telegram.org/file/bot<token>/<file_path>).
    # Precisa bot_token — resolve via TaConnector lookup.
    async def _resolve_telegram_url(file_id: str) -> str | None:
        try:
            from sqlalchemy import select as _sel

            from core.encryption import decrypt
            from models import TaConnector

            res = await db.execute(
                _sel(TaConnector).where(
                    TaConnector.kind == "telegram", TaConnector.enabled.is_(True)
                )
            )
            for conn in res.scalars().all():
                try:
                    import json as _json

                    cfg = _json.loads(decrypt(conn.config_json_enc))
                    token = cfg.get("bot_token") or ""
                    if not token:
                        continue
                    cbot_id = token.split(":")[0] if ":" in token else ""
                    if cbot_id != bot_id:
                        continue
                    import httpx as _httpx

                    async with _httpx.AsyncClient(timeout=10) as cli:
                        r = await cli.get(f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}")
                        if r.status_code != 200:
                            return None
                        d = r.json()
                        if not d.get("ok"):
                            return None
                        file_path = d["result"].get("file_path")
                        if not file_path:
                            return None
                        return f"https://api.telegram.org/file/bot{token}/{file_path}"
                except Exception:
                    continue
        except Exception:
            return None
        return None

    if msg.get("voice"):
        file_id = msg["voice"].get("file_id")
        url = await _resolve_telegram_url(file_id) if file_id else None
        attachments.append(
            ConnectorAttachment(
                kind="audio",
                url=url,
                mime=msg["voice"].get("mime_type") or "audio/ogg",
            )
        )
    elif msg.get("photo"):
        # photo é lista de tamanhos — pega o maior (último)
        photos = msg["photo"] if isinstance(msg["photo"], list) else []
        if photos:
            file_id = photos[-1].get("file_id")
            url = await _resolve_telegram_url(file_id) if file_id else None
            attachments.append(ConnectorAttachment(kind="image", url=url, mime="image/jpeg"))
    elif msg.get("document"):
        file_id = msg["document"].get("file_id")
        url = await _resolve_telegram_url(file_id) if file_id else None
        attachments.append(
            ConnectorAttachment(
                kind="document",
                url=url,
                mime=msg["document"].get("mime_type") or "application/octet-stream",
            )
        )

    if not text_content:
        text_content = f"[{attachments[0].kind}]" if attachments else "[mensagem sem texto]"

    result = await agent_runtime.handle_inbound_message(
        db,
        connector_kind="telegram",
        instance_id=bot_id,
        external_chat_id=chat_id,
        sender_name=sender_name,
        text_content=text_content,
        attachments=attachments,
    )
    logger.info("webhook telegram processed bot=%s chat=%s status=%s", bot_id, chat_id, result.get("status"))
    return result


# ============================================================
# Instagram DM inbound — Meta Graph API webhook
# ============================================================
@router.get("/instagram/{ig_user_id}")
async def instagram_verify(
    ig_user_id: str,
    request: Request,
):
    """Verify token handshake do Meta (GET com hub.mode=subscribe + hub.verify_token + hub.challenge)."""
    import os as _os

    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    expected = _os.environ.get("META_WEBHOOK_VERIFY_TOKEN")
    if mode == "subscribe" and token == expected and challenge:
        return int(challenge) if challenge.isdigit() else challenge
    raise HTTPException(403, "Verify token mismatch")


@router.post("/instagram/{ig_user_id}")
async def instagram_webhook(
    ig_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Recebe DM Instagram via Meta Graph webhook.

    Payload Meta:
    {
      "object": "instagram",
      "entry": [{
        "id": "<ig_user_id>",
        "time": ...,
        "messaging": [{
          "sender": {"id": "<scoped_user_id>"},
          "recipient": {"id": "<ig_user_id>"},
          "timestamp": ...,
          "message": {"mid": "...", "text": "...", "attachments": [...]}
        }]
      }]
    }
    """
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(400, "JSON inválido")

    if data.get("object") != "instagram":
        return {"status": "ignored", "reason": "not_instagram_object"}

    from services import agent_runtime
    from services.connectors.base import ConnectorAttachment

    results = []
    for entry in data.get("entry") or []:
        for ev in entry.get("messaging") or []:
            msg = ev.get("message") or {}
            if msg.get("is_echo"):
                continue
            mid = msg.get("mid") or ""
            if not mid:
                continue
            sender_id = (ev.get("sender") or {}).get("id") or ""
            if not sender_id:
                continue

            if await _record_idempotent(db, f"instagram:{ig_user_id}", mid, ev):
                continue

            text_content = (msg.get("text") or "").strip()
            attachments: list[ConnectorAttachment] = []
            for att in msg.get("attachments") or []:
                t = att.get("type")
                payload = att.get("payload") or {}
                url = payload.get("url")
                if not url:
                    continue
                if t in ("image", "story_mention"):
                    attachments.append(ConnectorAttachment(kind="image", url=url, mime="image/jpeg"))
                elif t == "audio":
                    attachments.append(ConnectorAttachment(kind="audio", url=url, mime="audio/mpeg"))
                elif t == "video":
                    attachments.append(ConnectorAttachment(kind="video", url=url, mime="video/mp4"))
                elif t == "file":
                    attachments.append(ConnectorAttachment(kind="document", url=url))

            if not text_content and attachments:
                text_content = f"[{attachments[0].kind}]"
            if not text_content:
                continue

            result = await agent_runtime.handle_inbound_message(
                db,
                connector_kind="instagram",
                instance_id=ig_user_id,
                external_chat_id=sender_id,
                sender_name=None,
                text_content=text_content,
                attachments=attachments,
            )
            results.append({"sender": sender_id, "status": result.get("status")})

    logger.info("webhook instagram processed ig=%s events=%s", ig_user_id, len(results))
    return {"status": "ok", "processed": results}


# ============================================================
# Email inbound — webhook genérico (Mailgun/Postmark/SES/Stalwart)
# ============================================================
@router.post("/email/{connector_id}")
async def email_webhook(
    connector_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Recebe email inbound de provider externo.

    Cliente configura forward upstream pra este URL. Aceita payloads:
    - Mailgun: from, To, subject, body-plain, body-html, Message-Id
    - Postmark: From, To, Subject, TextBody, HtmlBody, MessageID
    - SES SNS: Records[0].ses.mail.commonHeaders.{from,to,subject}, content
    - Genérico: {from, to, subject, text}

    Normaliza tudo pra {from_addr, subject, text}.
    """
    try:
        ct = request.headers.get("content-type", "")
        if "application/json" in ct:
            data = await request.json()
        else:
            form = await request.form()
            data = dict(form)
    except Exception:
        raise HTTPException(400, "Body inválido")

    # Extrai from/subject/text de qualquer formato
    from_addr = (
        data.get("from")
        or data.get("From")
        or data.get("sender")
        or (data.get("envelope") or {}).get("from")
        or ""
    )
    # Limpa "Nome <email@x.com>" → "email@x.com"
    import re as _re

    m = _re.search(r"<([^>]+)>", str(from_addr))
    if m:
        from_addr = m.group(1).strip()
    else:
        from_addr = str(from_addr).strip()

    subject = (
        data.get("subject")
        or data.get("Subject")
        or ""
    )
    text = (
        data.get("body-plain")
        or data.get("TextBody")
        or data.get("text")
        or data.get("stripped-text")
        or ""
    )
    sender_name = data.get("from_name") or data.get("FromName") or ""

    msg_id = (
        data.get("Message-Id")
        or data.get("MessageID")
        or data.get("message_id")
        or f"email-{connector_id}-{datetime.utcnow().timestamp()}"
    )

    if not from_addr:
        return {"status": "ignored", "reason": "no_from"}
    if not (subject or text):
        return {"status": "ignored", "reason": "empty"}

    if await _record_idempotent(db, f"email:{connector_id}", str(msg_id), {"from": from_addr, "subject": subject}):
        return {"status": "duplicate"}

    # Resolve connector pelo ID
    from sqlalchemy import select as _sel

    conn = (
        await db.execute(_sel(TaConnector).where(TaConnector.id == connector_id))
    ).scalar_one_or_none()
    if not conn or conn.kind != "email":
        raise HTTPException(404, "Connector email não encontrado")

    text_content = f"Subject: {subject}\n\n{text}".strip()

    from services import agent_runtime

    # Pra email, instance_id virtual = connector_id (resolve direto via fallback)
    # Mas precisa modificar resolve_connector_by_instance pra match email kind.
    # Workaround: passa connector encontrado direto via agent_id no agent_runtime
    # Por simplicidade, usa instance_id=str(connector_id) e resolve fallback funciona
    # se cfg tiver instance_id=connector_id setado, OU adicionar branch email no resolver.
    # Pra MVP: passa connector_id como instance_id, fallback simples.

    result = await agent_runtime.handle_inbound_message(
        db,
        connector_kind="email",
        instance_id=str(connector_id),
        external_chat_id=from_addr,
        sender_name=str(sender_name) or None,
        text_content=text_content,
    )
    logger.info("webhook email processed conn=%s from=%s status=%s", connector_id, from_addr, result.get("status"))
    return result


# ============================================================
# Trigger event — webhook externo dispara playbooks com trigger_event
# ============================================================
@router.post("/event/{event_key}")
async def trigger_event_webhook(
    event_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Dispara TODOS playbooks publicados com trigger_event matching event_key.

    Sem autenticação por padrão (URL secret-ish via event_key).
    Body JSON inteiro vira `vars.event` no execution.

    Exemplos:
        POST /webhooks/event/pedido_criado {"pedido_id": 123, "valor_cents": 19900}
        POST /webhooks/event/pagamento_aprovado {"order_id": "abc"}

    Resposta:
        {triggered: N, executions: [{playbook_id, execution_id, status}, ...]}
    """
    try:
        body_json = await request.json()
    except Exception:
        body_json = {}

    if not isinstance(body_json, dict):
        body_json = {"raw": body_json}

    # Idempotency opcional via header X-Event-Id (se cliente fornecer)
    event_id = request.headers.get("X-Event-Id") or str(uuid.uuid4())
    duplicate = await _record_idempotent(
        db, source=f"event:{event_key}", event_id=event_id, payload=body_json
    )
    if duplicate:
        return {"status": "duplicate", "event_id": event_id, "triggered": 0}

    # Busca triggers ativos pra este event_key
    rows = (
        await db.execute(
            select(TaPlaybookTriggerIndex, TaPlaybook)
            .join(TaPlaybook, TaPlaybook.id == TaPlaybookTriggerIndex.playbook_id)
            .where(
                TaPlaybookTriggerIndex.trigger_type == "trigger_event",
                TaPlaybookTriggerIndex.enabled.is_(True),
                TaPlaybook.status == "published",
            )
        )
    ).all()

    matches = []
    for idx, pb in rows:
        data = idx.trigger_data or {}
        if (data.get("event_key") or "") != event_key:
            continue
        matches.append((idx, pb))

    if not matches:
        return {"status": "no_match", "event_key": event_key, "triggered": 0}

    executions = []
    for idx, pb in matches:
        try:
            result = await playbook_executor.run_playbook(
                db,
                playbook_id=pb.id,
                trigger_node_id=idx.node_id,
                trigger_type="trigger_event",
                agent_id=pb.agent_id,
                conversation_id=None,
                inbound_text=None,
                inbound_sender=None,
                connector_kind=None,
                external_chat_id=None,
                initial_vars={"event": body_json, "event_key": event_key},
            )
            executions.append(
                {
                    "playbook_id": pb.id,
                    "execution_id": result.get("execution_id"),
                    "status": result.get("status"),
                    "steps_executed": result.get("steps_executed"),
                }
            )
        except Exception as e:
            logger.exception("trigger_event execução falhou pb=%s", pb.id)
            executions.append({"playbook_id": pb.id, "error": str(e)})

    return {
        "status": "ok",
        "event_key": event_key,
        "event_id": event_id,
        "triggered": len(executions),
        "executions": executions,
    }
