"""Agent runtime — orquestra recepção de mensagem → Engine → envio de volta no canal.

Fluxo:
1. Webhook channel chega
2. resolve_agent_from_connector identifica o agente
3. ensure_conversation cria/atualiza TaConversation
4. tier_engine.send_message → Engine responde
5. connectors.registry.send → envia resposta de volta no canal
6. log usage em TaMessageLog + TaUsageDaily
"""

import json
import logging
import os
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt
from models import TaAgent, TaConnector, TaConversation, TaMessageLog, TaUsageDaily
from services import tier_engine, playbook_executor, playbook_router, templates as _templates
from services.connectors import registry
from services.connectors.base import ConnectorConfig, OutboundMessage

logger = logging.getLogger(__name__)


async def build_rag_block(db: AsyncSession, agent_id: int, query: str) -> tuple[str, list[str]]:
    """Monta o bloco de Base de Conhecimento pro system prompt.

    Extraido pra ser o PONTO UNICO de RAG: producao (send_message, abaixo) e o
    playground do painel usam esta mesma funcao. Antes o playground chamava o
    motor de LLM direto, sem RAG nenhum — entao o cliente subia um documento,
    testava, o agente nao sabia, e ele concluia que a indexacao estava quebrada.
    Testar com um caminho diferente do de producao nao e testar.

    Devolve (bloco, fontes). Nunca levanta: RAG e enriquecimento, nao requisito —
    se a busca falhar o agente responde sem ela, como sempre respondeu.
    """
    if not query or not query.strip():
        return "", []
    try:
        from sqlalchemy import text as _sa_text

        # So embeda a query se o agente TIVER conhecimento indexado (evita
        # chamada de embedding a toa em todo turno de agente sem base).
        tem_base = (
            await db.execute(
                _sa_text("SELECT 1 FROM ta_knowledge_chunk WHERE agent_id = :aid LIMIT 1"),
                {"aid": agent_id},
            )
        ).first()
        if not tem_base:
            return "", []

        from services import rag_engine

        hits = await rag_engine.search(db, agent_id=agent_id, query=query, top_k=4)
        if not hits:
            return "", []

        cabecalho = "# Base de conhecimento (responda com base nisto; não invente além)"
        corpo = "\n\n".join(f"- {h.text.strip()}" for h in hits)
        bloco = f"{cabecalho}\n{corpo}"
        fontes = []
        for h in hits:
            titulo = getattr(h, "title", None) or getattr(h, "source", None)
            if titulo and titulo not in fontes:
                fontes.append(str(titulo))
        logger.info("rag agent=%s hits=%s", agent_id, len(hits))
        return bloco, fontes
    except Exception:
        logger.exception("rag search falhou agent=%s — segue sem RAG", agent_id)
        return "", []



def build_contact_block(
    *, connector_kind: str, external_chat_id: str | None, sender_name: str | None
) -> str:
    """Bloco "Contato atual" — o agente JÁ tem nome/telefone pelo canal.

    Ponto ÚNICO: produção e playground montam o mesmo texto. Evita o agente pedir
    ao cliente dado que já temos (irrita, e cada atendente re-pergunta).
    """
    is_wa = connector_kind in ("whatsapp", "whatsapp_cloud")
    jid = external_chat_id or ""
    # LID (@lid) é um ID INTERNO do WhatsApp, NÃO o telefone real — não apresentar
    # como telefone (senão o agente cadastra com número falso e nunca acha).
    is_lid = "@lid" in jid
    phone = "" if (not is_wa or is_lid) else _re.sub(r"\D", "", jid.split("@")[0])
    out = ["# Contato atual (você JÁ tem estes dados — NÃO peça ao cliente)"]
    out.append(f"- Nome: {sender_name or '(não informado pelo WhatsApp)'}")
    if phone:
        out.append(
            f"- Telefone/WhatsApp: {phone} — este JÁ é o número do cliente. Ao buscar ou cadastrar, "
            "use este número DIRETO. NUNCA pergunte o telefone/WhatsApp."
        )
    elif is_wa:
        out.append(
            "- Telefone/WhatsApp: não veio automaticamente nesta conversa. Se for cadastrar o "
            "cliente e ele JÁ tiver dito o número aqui, USE o que ele disse — não peça de novo. "
            "Cadastre com o nome do WhatsApp + o que tiver; só peça o número UMA vez se for "
            "realmente indispensável (ex.: contato pro Taxidog) e ele nunca tiver informado."
        )
    out.append(
        "Use esses dados diretamente. NUNCA peça o nome (você já tem). Pergunte só o que "
        "realmente falta."
    )
    return "\n".join(out)


def build_base_directives(agent, *, connector_kind: str, extra_block: str = "") -> str:
    """Data/hora + diretrizes base herdadas por TODO agente.

    Ponto ÚNICO, pelo mesmo motivo do bloco de contato. A persona TEM PRIORIDADE;
    isto só preenche lacunas. Resolve "não sei a data", loop de perguntas repetidas
    e alucinação de horário. `extra_block` entra na MESMA posição em que o runtime
    injetava os alertas do DevSecOps (antes das regras de formatação do WhatsApp).
    """
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo as _ZoneInfo

    DIAS = [
        "segunda-feira",
        "terça-feira",
        "quarta-feira",
        "quinta-feira",
        "sexta-feira",
        "sábado",
        "domingo",
    ]
    agora = _dt.now(_ZoneInfo("America/Sao_Paulo"))
    date_block = (
        "# Data e hora atuais (fuso de São Paulo — use SEMPRE isto como referência)\n"
        f"- Hoje é {DIAS[agora.weekday()]}, {agora.strftime('%d/%m/%Y')}, {agora.strftime('%H:%M')}.\n"
        "- Ao falar de 'hoje', 'amanhã', 'esta semana' ou dias da semana, calcule a partir desta data. "
        "NUNCA diga que não sabe a data.\n\n"
    )
    # Diretrizes GENÉRICAS + guidelines do TEMPLATE do agente (definidas em
    # services/templates.py — o runtime não conhece nenhum nicho).
    base = date_block + _templates.GENERIC_GUIDELINES
    tmpl = _templates.get_template(agent.template_kind or "")
    if tmpl is not None and tmpl.guidelines:
        base = f"{base}\n\n{tmpl.guidelines}"
    if extra_block:
        base = f"{base}\n\n{extra_block}"
    if connector_kind in ("whatsapp", "whatsapp_cloud"):
        base += (
            "\n\n# Formatação no WhatsApp\n"
            "- Use SÓ a formatação nativa do WhatsApp: *negrito* (UM asterisco), _itálico_. "
            "NUNCA use markdown (**, ##, ###, ou '-' como marcador).\n"
            "- Listas: uma linha por item começando com '• ' (bullet). Nada de '-' nem '*' como marcador.\n"
            "- Emoji com parcimônia (no máximo 1 por mensagem, e nunca como marcador de lista).\n"
            "- Mensagens curtas e escaneáveis; evite blocos longos de texto."
        )
    return base


# Filtro de segurança: remove caracteres CJK (chinês/japonês/coreano) que o
# MiniMax ocasionalmente vaza em respostas em português. 2ª camada sobre a regra
# de idioma da persona — garante que o cliente nunca veja caractere oriental.
import re as _re

# Observabilidade: grava o system prompt / memory / RAG no log da resposta do assistant
# (debug "ver o que foi enviado ao LLM"). Desligar com TA_LOG_PROMPTS=0.
_LOG_PROMPTS = os.getenv("TA_LOG_PROMPTS", "1") != "0"

_CJK_RE = _re.compile(
    r"[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿"
    r"豈-﫿＀-￯가-힯\U00020000-\U0003FFFF]"
)


# Emoji de bandeira = "regional indicators" (U+1F1E6–U+1F1FF) que o MiniMax às vezes
# injeta aleatoriamente (ex: as bandeiras depois de "Perfeito!"). Nunca intencionais
# no atendimento → remove antes do envio.
_FLAG_RE = _re.compile(r"[\U0001F1E6-\U0001F1FF]")


def _sanitize_reply(text: str | None) -> str:
    """Remove CJK vazado + emoji de bandeira aleatório e limpa espaços/pontuação."""
    if not text:
        return text or ""
    if not _CJK_RE.search(text) and not _FLAG_RE.search(text):
        return text
    cleaned = _CJK_RE.sub("", text)
    cleaned = _FLAG_RE.sub("", cleaned)
    cleaned = _re.sub(r"[ \t]{2,}", " ", cleaned)  # espaços duplos
    cleaned = _re.sub(r"\s+([.,!?;:])", r"\1", cleaned)  # espaço antes de pontuação
    logger.warning("resposta tinha CJK/bandeira vazado — caracteres removidos antes do envio")
    return cleaned.strip()


def _format_for_whatsapp(text: str) -> str:
    """Normaliza markdown que o modelo às vezes gera para a formatação NATIVA do
    WhatsApp. Markdown cru (`**negrito**`, `## título`, `- item`) aparece LITERAL no
    WhatsApp, e um `**` ou asterisco solto quebra o negrito da mensagem inteira."""
    if not text:
        return text or ""
    t = text
    # Cabeçalhos markdown (#, ##, ...) → *negrito*
    t = _re.sub(r"(?m)^[ \t]{0,3}#{1,6}[ \t]*(.+?)[ \t]*$", r"*\1*", t)
    # Negrito markdown **x** / ***x*** / __x__ → *x* (WhatsApp usa UM asterisco)
    t = _re.sub(r"\*\*+(.+?)\*\*+", r"*\1*", t)
    t = _re.sub(r"__(.+?)__", r"*\1*", t)
    # Marcadores de lista no início da linha (-, *, ·, •, –) → "• " (limpa espaço à esquerda)
    t = _re.sub(r"(?m)^[ \t]*[-*·•–][ \t]+", "• ", t)
    # Limpa espaço à direita e colapsa 3+ quebras de linha em 2
    t = _re.sub(r"[ \t]+\n", "\n", t)
    t = _re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _split_into_bubbles(text: str, max_len: int = 700) -> list[str]:
    """Divide resposta longa em até 4 balões (mais humano no WhatsApp).

    Quebra em parágrafos (\\n\\n), mantém listas/blocos inteiros, agrupa blocos
    pequenos. Resposta curta → 1 balão (sem split)."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_len:
        return [text]
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    bubbles: list[str] = []
    cur = ""
    for b in blocks:
        if len(b) > max_len:  # bloco grande (ex: lista de planos) → balão próprio
            if cur:
                bubbles.append(cur)
                cur = ""
            bubbles.append(b)
            continue
        if cur and len(cur) + 2 + len(b) > max_len:
            bubbles.append(cur)
            cur = b
        else:
            cur = (cur + "\n\n" + b) if cur else b
    if cur:
        bubbles.append(cur)
    return bubbles[:4]


async def resolve_connector_by_instance(
    db: AsyncSession, kind: str, instance_id: str
) -> TaConnector | None:
    """Procura TaConnector cujo config_json_enc contenha instance_id (heurística por canal)."""
    result = await db.execute(
        select(TaConnector).where(TaConnector.kind == kind, TaConnector.enabled.is_(True))
    )
    for conn in result.scalars().all():
        try:
            cfg = json.loads(decrypt(conn.config_json_enc))
        except Exception:
            continue
        # WhatsApp: match instance_id direto
        if kind == "whatsapp" and cfg.get("instance_id") == instance_id:
            return conn
        # WhatsApp Cloud API (oficial): instance_id = phone_number_id
        if kind == "whatsapp_cloud" and str(cfg.get("phone_number_id") or "") == instance_id:
            return conn
        # Telegram: instance_id = bot_id (extraído do bot_token "1234567:ABCdef...")
        if kind == "telegram":
            token = cfg.get("bot_token") or ""
            bot_id = token.split(":")[0] if ":" in token else ""
            if bot_id and bot_id == instance_id:
                return conn
        # Email: instance_id = connector.id direto (webhook usa /email/{connector_id})
        if kind == "email":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Slack: instance_id = connector.id direto (webhook usa /slack/{connector_id})
        if kind == "slack":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Discord: instance_id = connector.id direto (Gateway worker usa conn.id)
        if kind == "discord":
            try:
                if int(instance_id) == conn.id:
                    return conn
            except (ValueError, TypeError):
                pass
        # Instagram: instance_id = ig_user_id (instagram business account id)
        if kind == "instagram":
            if str(cfg.get("ig_user_id") or "") == instance_id:
                return conn
        # Webchat (link público / demonstração): instance_id = slug do link
        if kind == "webchat":
            if str(cfg.get("slug") or "") == instance_id:
                return conn
        # Default fallback (compat)
        if cfg.get("instance_id") == instance_id:
            return conn
    return None


async def ensure_conversation(
    db: AsyncSession,
    agent_id: int,
    connector_kind: str,
    external_id: str,
    contact_name: str | None = None,
) -> TaConversation:
    result = await db.execute(
        select(TaConversation)
        .where(
            TaConversation.agent_id == agent_id,
            TaConversation.connector_kind == connector_kind,
            TaConversation.external_id == external_id,
            TaConversation.status == "active",
        )
        # .first() (não scalar_one_or_none): tolera conversas ativas duplicadas
        # (race de 2 mensagens quase simultâneas) sem quebrar o atendimento.
        .order_by(TaConversation.id.desc())
        .limit(1)
    )
    conv = result.scalars().first()
    if conv:
        conv.last_message_at = datetime.utcnow()
        conv.msg_count += 1
        if conv.snoozed_until is not None:
            conv.snoozed_until = None  # cliente voltou — tira do snooze
        await db.commit()
        return conv

    conv = TaConversation(
        agent_id=agent_id,
        connector_kind=connector_kind,
        external_id=external_id,
        contact_name=contact_name,
        msg_count=1,
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


async def log_message(
    db: AsyncSession,
    *,
    conversation_id: int,
    tenant_id: int,
    role: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: int = 0,
    latency_ms: int = 0,
    model_used: str | None = None,
    content: str | None = None,
    tool_calls_json: list | None = None,
    brakes_fired: list | None = None,
    attachments_json: list | None = None,
    system_prompt_sent: str | None = None,
    memory_block: str | None = None,
    rag_block: str | None = None,
) -> None:
    log = TaMessageLog(
        conversation_id=conversation_id,
        role=role,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_cents=cost_cents,
        latency_ms=latency_ms,
        model_used=model_used,
        content=(content or "")[:8000] or None,
        tool_calls_json=tool_calls_json or None,
        brakes_fired=brakes_fired or None,
        attachments_json=attachments_json or None,
        system_prompt_sent=(system_prompt_sent or None),
        memory_block=(memory_block or None),
        rag_block=(rag_block or None),
    )
    db.add(log)

    # Atualiza usage daily (upsert)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    result = await db.execute(
        select(TaUsageDaily)
        .where(TaUsageDaily.tenant_id == tenant_id, TaUsageDaily.day == today)
        .order_by(TaUsageDaily.id.desc())
        .limit(1)
    )
    usage = result.scalars().first()  # .first() tolera linhas duplicadas sem quebrar
    if usage:
        usage.messages += 1
        usage.tokens_in += tokens_in
        usage.tokens_out += tokens_out
        usage.cost_cents += cost_cents
    else:
        db.add(
            TaUsageDaily(
                tenant_id=tenant_id,
                day=today,
                messages=1,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_cents=cost_cents,
            )
        )
    await db.commit()


async def load_history(db: AsyncSession, conversation_id: int, limit: int = 80) -> list[dict]:
    """Carrega os últimos turnos (user/assistant) da conversa pra dar MEMÓRIA ao
    modelo. Sem isso o agente trata cada mensagem isolada e "esquece" o cliente
    (responde "nao" com saudação genérica). Exclui a mensagem atual do usuário
    (já gravada antes de chamar o engine) — ela vai separada como user_content.
    """
    rows = (
        await db.execute(
            select(TaMessageLog)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.role.in_(["user", "assistant"]),
                TaMessageLog.content.isnot(None),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(limit + 1)
        )
    ).scalars().all()
    rows = list(reversed(rows))  # ordem cronológica
    if rows:
        rows = rows[:-1]  # remove o turno atual (acabou de ser logado)
    return [{"role": r.role, "content": r.content} for r in rows]


async def _log_deterministic_turn(db, agent, connector_kind, external_id, contact_name, user_text, reply):
    """Loga (user + assistant) de um turno DETERMINÍSTICO (ops-command/guard) no inbox.

    Esses caminhos respondem sem LLM e retornam cedo; sem isto, a interação fica invisível
    nas conversas do painel (foi o motivo de `/ajuda`, `Infra` etc. não aparecerem). Logar
    aqui também deixa a resposta legível no painel mesmo quando o WhatsApp não consegue
    descriptografar (sessão Baileys quebrada).

    🚨 Usa uma SESSÃO PRÓPRIA (`SessionLocal`), nunca o `db` do caller. A telemetria de ops
    pode deixar `db` com transação abortada; um `db.rollback()` aqui recuperava a sessão MAS
    expirava TODOS os ORMs do caller (`agent` E `connector`) — e logo depois o caller acessa
    `connector.config_json_enc` (enviar resposta) e `agent.id` (return). Em AsyncSession, ler
    atributo expirado dispara IO implícito proibido → `MissingGreenlet` → o caminho de ops
    estourava e caía no LLM ("fica só pensando", sem menu). Sessão isolada não toca no caller."""
    # Captura escalares do ORM em memória (ainda carregado — caller não deu rollback).
    agent_id = agent.id
    tenant_id = agent.tenant_id
    try:
        from core.db import SessionLocal

        async with SessionLocal() as s:
            conv = await ensure_conversation(
                s, agent_id=agent_id, connector_kind=connector_kind,
                external_id=external_id, contact_name=contact_name,
            )
            await log_message(s, conversation_id=conv.id, tenant_id=tenant_id, role="user", content=user_text)
            await log_message(s, conversation_id=conv.id, tenant_id=tenant_id, role="assistant", content=reply)
            await s.commit()
    except Exception:
        logger.exception("log de turno determinístico falhou agent=%s", agent_id)


async def handle_inbound_message(
    db: AsyncSession,
    *,
    connector_kind: str,
    instance_id: str,
    external_chat_id: str,
    sender_name: str | None,
    text_content: str,
    attachments: list | None = None,
) -> dict:
    """Pipeline completo: webhook → Engine → resposta no canal."""
    connector = await resolve_connector_by_instance(db, connector_kind, instance_id)
    if not connector:
        return {"status": "no_connector", "instance_id": instance_id}

    agent = await db.get(TaAgent, connector.agent_id)
    if not agent or not agent.active:
        return {"status": "agent_inactive", "agent_id": connector.agent_id}

    # ─── Transcrição de áudio (STT local, grátis) — vale pra TODOS os canais ───
    # Se chegou áudio sem texto real (ou só placeholder "[audio]"), transcreve
    # local via whisper. Centralizado aqui pra Cloud (Maria Luiza) + Baileys.
    try:
        _audio = next(
            (a for a in (attachments or [])
             if getattr(a, "kind", None) == "audio" and getattr(a, "url", None)),
            None,
        )
        _needs_stt = (not text_content) or text_content.strip().startswith("[")
        if _audio and _needs_stt:
            from services.voice import whisper_local

            _tr = await whisper_local.transcribe_url(_audio.url, language="pt")
            if _tr.ok and _tr.text:
                text_content = _tr.text
                logger.info(
                    "ASR ok agent=%s (%.1fs) text='%s'",
                    agent.id, _tr.duration_seconds, _tr.text[:80],
                )
            else:
                logger.warning("ASR falhou agent=%s: %s", agent.id, _tr.error)
                text_content = "[áudio não compreendido]"
    except Exception:
        logger.exception("ASR exception agent=%s — segue sem transcrição", agent.id)

    # ─── Comandos de ops (DevSecOps) — resposta determinística, sem LLM ───
    # Agente marcado como template_kind="devsecops" responde status/health/ping
    # com a saúde REAL do stack (sem alucinar). Conversa normal segue o fluxo.
    if agent.template_kind == "devsecops":
        try:
            from services import ops_commands

            if ops_commands.is_ops_command(text_content):
                reply = await ops_commands.handle_ops_command(db, agent, text_content)
                if reply:
                    await _log_deterministic_turn(
                        db, agent, connector_kind, external_chat_id, sender_name, text_content, reply
                    )
                    try:
                        connector_impl = registry.get(connector_kind)
                        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                        await connector_impl.send(
                            cfg, OutboundMessage(external_chat_id=external_chat_id, content=reply)
                        )
                    except Exception:
                        logger.exception("envio ops command falhou agent=%s", agent.id)
                    return {"status": "ops_command", "agent_id": agent.id}
        except Exception:
            logger.exception("ops_command falhou agent=%s — segue fluxo normal", agent.id)

        # Guard anti-injeção determinístico (independente do modelo). Recusa troca-de-papel
        # ANTES do LLM e re-ancora a identidade. Registra um incidente info pra observabilidade.
        try:
            from services import devops_guard

            if devops_guard.detect_injection(text_content):
                await _log_deterministic_turn(
                    db, agent, connector_kind, external_chat_id, sender_name, text_content, devops_guard.REFUSAL
                )
                try:
                    connector_impl = registry.get(connector_kind)
                    cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                    await connector_impl.send(
                        cfg, OutboundMessage(external_chat_id=external_chat_id, content=devops_guard.REFUSAL)
                    )
                except Exception:
                    logger.exception("envio do guard anti-injeção falhou agent=%s", agent.id)
                try:
                    from sqlalchemy import text as _sql_text

                    await db.execute(
                        _sql_text(
                            "INSERT INTO ta_incident (tenant_id, source, severity, kind, title, fingerprint, status) "
                            "VALUES (:t, 'agent-guard', 'info', 'prompt_injection', :title, :fp, 'open') "
                            "ON CONFLICT (fingerprint) WHERE status IN ('open','ack') AND fingerprint IS NOT NULL "
                            "DO UPDATE SET updated_at = now()"
                        ),
                        {
                            "t": agent.tenant_id,
                            "title": f"Tentativa de injeção de prompt no agente {agent.nome}",
                            "fp": f"injection|{agent.id}|{external_chat_id}",
                        },
                    )
                    await db.commit()
                except Exception:
                    logger.exception("registro de incidente de injeção falhou (não-fatal)")
                return {"status": "injection_blocked", "agent_id": agent.id}
        except Exception:
            logger.exception("guard anti-injeção falhou agent=%s — segue fluxo normal", agent.id)

    # ─── CSAT: resposta de avaliação (0-5) a uma conversa resolvida ───
    # Captura ANTES de ensure_conversation pra não abrir conversa nova.
    try:
        from services import csat

        thanks = await csat.maybe_capture_csat(
            db, agent_id=agent.id, external_chat_id=external_chat_id, text=text_content
        )
        if thanks:
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=thanks)
                )
            except Exception:
                logger.exception("envio csat thanks falhou agent=%s", agent.id)
            return {"status": "csat_captured", "agent_id": agent.id}
    except Exception:
        logger.exception("csat capture falhou agent=%s — segue fluxo normal", agent.id)

    # Q2.4 Budget guard — bloqueia tenant suspenso
    try:
        from services import budget_guard

        budget_state = await budget_guard.check_and_enforce(db, agent.tenant_id)
        if budget_state.get("status") == "paused":
            logger.warning(
                "budget guard: tenant=%s pausado (uso %.0f%%)",
                agent.tenant_id, (budget_state.get("pct") or 0) * 100,
            )
            return {"status": "tenant_suspended", "agent_id": agent.id, **budget_state}
    except Exception:
        logger.exception("budget_guard falhou — continua processando")

    # Q3.1 Guardrails Lakera — bloqueia prompt injection / jailbreak
    # Q2.6 Azure Content Safety — bloqueia hate/violence/sexual/self-harm
    try:
        from services import content_moderation, guardrails

        blocked_by: list[str] = []
        blocked_categories: list[str] = []

        if await guardrails.is_enabled_for_tenant(db, agent.tenant_id):
            gr = await guardrails.check_lakera(text_content)
            if not gr.ok:
                blocked_by.append("lakera")
                blocked_categories.extend(gr.blocked_categories)

        if not blocked_by and await content_moderation.is_enabled_for_tenant(db, agent.tenant_id):
            mr = await content_moderation.check_text(text_content)
            if not mr.ok:
                blocked_by.append("azure_content_safety")
                blocked_categories.extend(mr.blocked_categories)

        if blocked_by:
            logger.warning(
                "moderation BLOCKED agent=%s contact=%s by=%s categories=%s",
                agent.id, external_chat_id, blocked_by, blocked_categories,
            )
            safe_reply = (
                "Desculpe, não posso processar essa mensagem. Se for dúvida legítima, "
                "reformule por favor ou peça pra falar com um humano."
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=safe_reply)
                )
            except Exception:
                logger.exception("envio safe_reply moderation falhou")
            return {
                "status": "blocked_moderation",
                "agent_id": agent.id,
                "blocked_by": blocked_by,
                "categories": blocked_categories,
            }
    except Exception:
        logger.exception("moderation check falhou — continua processando")

    conv = await ensure_conversation(
        db,
        agent_id=agent.id,
        connector_kind=connector_kind,
        external_id=external_chat_id,
        contact_name=sender_name,
    )

    # Log mensagem do user (com mídia, se houver — pra aparecer em Anexos/inline)
    _att = [
        {"kind": getattr(a, "kind", "file"), "url": getattr(a, "url", None), "mime": getattr(a, "mime", None)}
        for a in (attachments or [])
        if getattr(a, "url", None)
    ]
    await log_message(
        db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="user", tokens_in=0,
        content=text_content, attachments_json=_att or None,
    )

    # ─── Conversa já assumida por humano? Bot fica em silêncio ───
    # Quando alguém da equipe assumiu (status handed_off), o bot NÃO responde mais
    # automaticamente — só registra a mensagem do cliente (visível na inbox) pra o
    # humano conduzir. "Devolver para a IA" (resume) volta o status pra active.
    if conv.status == "handed_off":
        logger.info("conv=%s handed_off — bot em silêncio (humano no controle)", conv.id)
        return {"status": "handed_off_paused", "agent_id": agent.id, "conversation_id": conv.id}

    _phone_for_summary = _re.sub(r"\D", "", (external_chat_id or "").split("@")[0])
    # Telefone real do contato, injetado nas tools de cadastro/busca. Só canal
    # telefônico tem telefone no chat_id — em webchat/Slack/Discord o id é sessão
    # ou usuário, e extrair dígitos dali inventaria um número que não existe.
    _phone = _phone_for_summary if connector_kind in ("whatsapp", "whatsapp_cloud") else ""

    # ─── Handoff explícito + escalonamento por frustração ───
    # Pedido explícito de humano → handoff + PAUSA o bot + confirma ao cliente.
    # Frustração detectada → ALERTA o time (warm handoff), mas o bot CONTINUA
    # tentando ajudar (ref: Fin tenta resolver antes; sentimento não pausa sozinho).
    try:
        from services import escalation, handoff

        if handoff.wants_human(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_EXPLICIT,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_EXPLICIT,
                summary=summary,
                pause=True,
            )
            # Fora do expediente → mensagem de fora-de-horário no lugar da padrão
            from services import business_hours

            try:
                aberto = await business_hours.is_open(db, agent.tenant_id)
            except Exception:
                aberto = True
            handoff_reply = (
                handoff.HANDOFF_REPLY
                if aberto
                else await business_hours.offhours_message(db, agent.tenant_id)
            )
            try:
                connector_impl = registry.get(connector_kind)
                cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
                await connector_impl.send(
                    cfg,
                    OutboundMessage(external_chat_id=external_chat_id, content=handoff_reply),
                )
            except Exception:
                logger.exception("envio handoff reply falhou agent=%s", agent.id)
            await log_message(
                db, conversation_id=conv.id, tenant_id=agent.tenant_id, role="assistant",
                content=handoff_reply,
            )
            return {"status": "handoff", "agent_id": agent.id, "conversation_id": conv.id}

        if escalation.is_frustrated(text_content):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_FRUSTRATION,
                contact_name=sender_name, phone=_phone_for_summary,
            )
            # pause=False: alerta o time, mas o bot segue respondendo abaixo.
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_FRUSTRATION,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("handoff/escalation check falhou agent=%s — segue fluxo normal", agent.id)

    # ─── Playbook router (Sprint 1) ───
    # Intercepta antes do Engine. Se nenhuma trigger matchou, cai pro fluxo padrão.
    try:
        match = await playbook_router.match_inbound_message(
            db, agent_id=agent.id, text=text_content
        )
    except Exception:
        logger.exception("playbook_router falhou agent=%s — fallback pro Engine", agent.id)
        match = None

    if match:
        logger.info(
            "agent_runtime: matched playbook_id=%s trigger=%s agent=%s",
            match.playbook_id, match.trigger_type, agent.id,
        )
        try:
            result = await playbook_executor.run_playbook(
                db,
                playbook_id=match.playbook_id,
                trigger_node_id=match.trigger_node_id,
                trigger_type=match.trigger_type,
                agent_id=agent.id,
                conversation_id=conv.id,
                inbound_text=text_content,
                inbound_sender=sender_name,
                connector_kind=connector_kind,
                external_chat_id=external_chat_id,
            )
            return {
                "status": "ok",
                "via": "playbook",
                "playbook_id": match.playbook_id,
                "agent_id": agent.id,
                "conversation_id": conv.id,
                **result,
            }
        except Exception as e:
            logger.exception(
                "playbook_executor falhou playbook=%s agent=%s — fallback pro Engine",
                match.playbook_id, agent.id,
            )
            # cai pro Engine free como fallback

    # Memory cross-session: busca fatos relevantes do contato + injeta no system
    from services import memory_service

    memory_block = ""
    try:
        mem_hits = await memory_service.search(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            external_chat_id=external_chat_id,
            query=text_content,
            top_k=5,
        )
        if mem_hits:
            memory_block = memory_service.format_for_prompt(mem_hits)
    except Exception:
        logger.exception("memory.search falhou agent=%s — segue sem memory", agent.id)

    system_prompt = agent.persona or agent.system_prompt or ""
    if memory_block:
        system_prompt = f"{system_prompt}\n\n{memory_block}".strip()

    # RAG: busca conhecimento relevante na Base e injeta no system.
    rag_block, _rag_fontes = await build_rag_block(db, agent.id, text_content)
    if rag_block:
        system_prompt = f"{system_prompt}\n\n{rag_block}"

    # Contexto do contato + diretrizes base: montados em PONTO ÚNICO
    # (build_contact_block / build_base_directives), pra o playground do painel
    # produzir exatamente o mesmo prompt. Testar com prompt diferente do de
    # produção não é testar — foi o que fez o teste do painel divergir do WhatsApp.
    system_prompt = f"{system_prompt}\n\n" + build_contact_block(
        connector_kind=connector_kind,
        external_chat_id=external_chat_id,
        sender_name=sender_name,
    )

    # DevOps: injeta os últimos alertas/incidentes REAIS no contexto, pra responder
    # "qual o último alerta?" direto — sem mandar o usuário rodar comando no servidor.
    # Fica aqui (e não no builder) porque precisa de `db` e é async.
    _extra_blk = ""
    if (agent.template_kind or "") == "devsecops":
        try:
            from services import ops_commands as _ops

            _extra_blk = await _ops.recent_alerts_block(db, agent.tenant_id, 6) or ""
        except Exception:
            logger.exception("inject alerts block falhou agent=%s", agent.id)

    system_prompt = f"{system_prompt}\n\n" + build_base_directives(
        agent, connector_kind=connector_kind, extra_block=_extra_blk
    )

    # Histórico da conversa → memória do modelo (senão "esquece" o cliente)
    history: list[dict] = []
    try:
        history = await load_history(db, conv.id)
    except Exception:
        logger.exception("load_history falhou agent=%s — segue sem histórico", agent.id)

    # Engine responde (com vision se attachment image presente)
    try:
        reply = await tier_engine.send_message(
            tenant_id=agent.tenant_id,
            user_content=text_content,
            db=db,
            session_id=f"conv-{conv.id}",
            system_override=system_prompt,
            attachments=attachments or [],
            agent_id=agent.id,
            history=history,
            use_cache=not (memory_block or rag_block),  # contextual → sem cache
            customer_phone=_phone or None,  # telefone real do contato → injetado nas tools de cadastro/busca
        )
    except tier_engine.ProvidersAllDisabled:
        # Tenant desligou todas as LLMs de propósito → agente fica em silêncio (sem
        # cair no modelo global da plataforma). NÃO manda nada pro cliente.
        logger.info(
            "LLM do tenant desativada (todas off) — agente em silêncio tenant=%s agent=%s",
            agent.tenant_id, agent.id,
        )
        return {"status": "llm_disabled"}
    except Exception as e:
        logger.exception("Engine falhou tenant=%s agent=%s", agent.tenant_id, agent.id)
        return {"status": "engine_error", "error": str(e)}

    # Calcula custo real via TaLlmProvider lookup
    from services import cost_calculator

    cost_cents = await cost_calculator.calculate_cost_cents(
        db,
        agent.tenant_id,
        model_used=reply.model_used,
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
    )

    # Observabilidade/eval: tool calls (args truncados) + freios disparados no turno.
    _tool_calls_log = [
        {"name": c.get("name"), "args": json.dumps(c.get("args"), ensure_ascii=False)[:300]}
        for c in (reply.tool_calls_made or [])
    ] or None

    # Log resposta do assistant
    await log_message(
        db,
        conversation_id=conv.id,
        tenant_id=agent.tenant_id,
        role="assistant",
        tokens_in=reply.tokens_in,
        tokens_out=reply.tokens_out,
        cost_cents=cost_cents,
        latency_ms=reply.latency_ms,
        model_used=reply.model_used,
        content=reply.text,
        tool_calls_json=_tool_calls_log,
        brakes_fired=(reply.brakes_fired or None),
        system_prompt_sent=(system_prompt if _LOG_PROMPTS else None),
        memory_block=(memory_block if _LOG_PROMPTS else None),
        rag_block=(rag_block if _LOG_PROMPTS else None),
    )

    # Envia resposta de volta no canal
    try:
        connector_impl = registry.get(connector_kind)
        cfg = ConnectorConfig(data=json.loads(decrypt(connector.config_json_enc)))
        _clean = _sanitize_reply(reply.text)
        if connector_kind in ("whatsapp", "whatsapp_cloud"):
            _clean = _format_for_whatsapp(_clean)
        _bubbles = _split_into_bubbles(_clean)
        # Sem delay aditivo aqui: o timing humano (pausa de leitura + '…digitando'
        # enquanto o LLM gera) é feito no handler do webhook, antes desta etapa.
        if len(_bubbles) <= 1:
            await connector_impl.send(
                cfg, OutboundMessage(external_chat_id=external_chat_id, content=_clean)
            )
        else:
            import asyncio as _asyncio

            for _i, _b in enumerate(_bubbles):
                await connector_impl.send(
                    cfg, OutboundMessage(external_chat_id=external_chat_id, content=_b)
                )
                if _i < len(_bubbles) - 1:
                    await _asyncio.sleep(1.2)  # pausa natural entre balões
    except Exception as e:
        logger.exception("Falha enviando resposta agent=%s channel=%s", agent.id, connector_kind)
        return {"status": "send_error", "agent_id": agent.id, "error": str(e)}

    # Espelho em TEMPO REAL pro Hovio Pet (se o agente estiver conectado a um petshop).
    # Fire-and-forget — não bloqueia. O job periódico (60s) fica só como backstop.
    try:
        import asyncio as _aio_mirror

        from services import pet_mirror

        _aio_mirror.create_task(pet_mirror.mirror_recent_to_pet(agent.id, conv.id))
    except Exception:
        logger.exception("agendar mirror realtime falhou agent=%s", agent.id)

    # Captura de lead — se o cliente demonstrou intenção de compra ou informou
    # telefone, registra um lead pra equipe (não perder oportunidades). Não bloqueia.
    try:
        from services import lead_capture

        await lead_capture.maybe_capture_lead(
            db,
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            external_chat_id=external_chat_id,
            sender_name=sender_name,
            user_text=text_content,
        )
    except Exception:
        logger.exception("lead_capture falhou agent=%s — ignorando", agent.id)

    # Auto-CRM: espelha TODA conversa nova como card no CRM do ERP (captura de lead
    # automática — não exige intenção de compra). Idempotente: dispara só enquanto a
    # conversa ainda não tem card (conv.crm_opportunity_id), então na prática roda 1x
    # (a 1ª mensagem cria o card e grava o id). Gated por TIER_ERP_AUTO_CRM. Best-effort.
    try:
        from core.config import get_settings

        # Idempotência AO VIVO (padrão de mercado): NÃO gateia por crm_opportunity_id
        # cacheado (fica stale se o card for apagado). Chama sempre — o ERP dedup pela
        # coluna indexada conversa_externa_id em card ATIVO. Apagou o card + mandou msg
        # → o ERP não acha nenhum ativo → recria. Sem sincronizar delete, sem stale.
        if get_settings().tier_erp_auto_crm:
            from services import erp_crm_client

            if erp_crm_client.integracao_ativa():
                import re as _re_crm

                # Foto: busca só quando ainda NÃO temos link (1ª vez / recriação). Nas msgs
                # seguintes o call é só o dedup barato (sem HTTP ao Engine). Se o card foi
                # apagado e recriado, o cliente mantém a foto (delete não apaga o cliente).
                # Só Baileys ('whatsapp'); Cloud API não expõe foto de contato.
                _foto = None
                if conv.crm_opportunity_id is None and connector_kind == "whatsapp" and connector is not None:
                    try:
                        import httpx as _httpx_pic
                        from urllib.parse import quote as _quote_pic

                        _cfg = json.loads(decrypt(connector.config_json_enc))
                        _iid = _cfg.get("instance_id")
                        _akey = _cfg.get("api_key")
                        _jid = external_chat_id or ""
                        if _iid and _akey and _jid:
                            if "@" not in _jid:
                                _jid = _re_crm.sub(r"\D", "", _jid) + "@s.whatsapp.net"
                            _base = get_settings().tier_whatsapp_engine_url
                            async with _httpx_pic.AsyncClient(timeout=5.0) as _pc:
                                _pr = await _pc.get(
                                    f"{_base}/v1/instances/{_iid}/contacts/{_quote_pic(_jid, safe='')}/profile-pic",
                                    headers={"X-API-Key": _akey},
                                )
                            if _pr.status_code < 400:
                                _foto = (_pr.json() or {}).get("url") or None
                    except Exception:
                        _foto = None

                _res = await erp_crm_client.enviar_conversa_para_crm(
                    agent_tenant_id=agent.tenant_id,
                    conversa_externa_id=str(conv.id),
                    contato_nome=sender_name,
                    contato_avatar=_foto,
                    telefone=_re_crm.sub(r"\D", "", external_chat_id or ""),
                    canal="whatsapp",
                    resumo=(text_content or "")[:300],
                )
                _op_id = _res.get("oportunidade_id") if isinstance(_res, dict) else None
                # Atualiza o link só se mudou (ex.: card recriado com id novo após delete).
                if _op_id and _op_id != conv.crm_opportunity_id:
                    conv.crm_opportunity_id = _op_id
                    await db.commit()
    except Exception:
        logger.exception("auto-CRM (todo lead) falhou agent=%s — ignorando", agent.id)

    # Qualificação automática: a mensagem do cliente preenche os campos do card.
    #
    # Roda DEPOIS do bloco acima porque depende do card já existir — na 1ª
    # mensagem o card acabou de nascer, e a resposta da pergunta ("qual série?")
    # chega nas mensagens seguintes, quando o auto-CRM já é só dedup.
    #
    # É chamada por mensagem, mas de propósito não custa modelo: o ERP casa o
    # texto contra a lista de opções do campo. Quem sabe quais campos existem é
    # o ERP — o agente não conhece "série" nem precisa. É isso que faz valer pra
    # qualquer cliente sem tocar no prompt.
    try:
        from core.config import get_settings

        if get_settings().tier_erp_auto_crm and (text_content or "").strip():
            from services import erp_crm_client

            if erp_crm_client.integracao_ativa():
                # A ULTIMA fala do agente vai junto. E o que transforma
                # casamento de texto em leitura de conversa: sabendo que a
                # pergunta foi "qual ano escolar?", a resposta "meu filho tem 8
                # anos" e a serie — sem isso e so um numero solto numa frase.
                _pergunta = None
                try:
                    _res = await db.execute(
                        select(TaMessageLog.content)
                        .where(
                            TaMessageLog.conversation_id == conv.id,
                            TaMessageLog.role == "assistant",
                        )
                        # `offset(1)`: a resposta DESTE turno já foi gravada
                        # lá em cima, então a mais nova é ela — a pergunta que
                        # o cliente respondeu é a anterior.
                        .order_by(TaMessageLog.id.desc())
                        .offset(1)
                        .limit(1)
                    )
                    _pergunta = _res.scalar_one_or_none()
                except Exception:  # noqa: BLE001
                    _pergunta = None

                _ext = await erp_crm_client.extrair_campos_da_conversa(
                    agent_tenant_id=agent.tenant_id,
                    conversa_externa_id=str(conv.id),
                    texto=text_content,
                    pergunta_anterior=_pergunta,
                )
                if isinstance(_ext, dict) and _ext.get("gravados"):
                    logger.info(
                        "auto-qualificação conv=%s gravou=%s etapa=%s",
                        conv.id, _ext.get("gravados"), _ext.get("moveu_para"),
                    )
    except Exception:
        logger.exception("auto-qualificação falhou agent=%s — ignorando", agent.id)

    # Loop sem resolução — bot respondeu "não sei" repetidas vezes. Alerta o time
    # (warm handoff) sem pausar o bot. Dedup evita spam (1 não-lida por conversa).
    try:
        from services import escalation, handoff

        if await escalation.detect_loop(db, conv.id, reply.text):
            summary = await escalation.build_context_summary(
                db, conversation_id=conv.id, reason=escalation.REASON_LOOP,
                contact_name=sender_name,
                phone=_re.sub(r"\D", "", (external_chat_id or "").split("@")[0]),
            )
            await handoff.create_handoff(
                db,
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                conversation_id=conv.id,
                external_chat_id=external_chat_id,
                sender_name=sender_name,
                user_text=text_content,
                reason=escalation.REASON_LOOP,
                summary=summary,
                pause=False,
            )
    except Exception:
        logger.exception("loop detection falhou agent=%s — ignorando", agent.id)

    # Memory.add em background (sessão isolada — não bloqueia resposta)
    try:
        import asyncio

        from core.db import db_context

        async def _async_add_memory():
            try:
                async with db_context() as mdb:
                    await memory_service.add(
                        mdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        user_text=text_content,
                        assistant_text=reply.text,
                        contact_name=sender_name,
                    )
                # Q2.6 Style adapter — primeiras 3 mensagens classifica tom + salva como preference
                from services import style_adapter

                async with db_context() as sdb:
                    await style_adapter.maybe_extract_style(
                        sdb,
                        tenant_id=agent.tenant_id,
                        agent_id=agent.id,
                        external_chat_id=external_chat_id,
                        text=text_content,
                        msg_count=conv.msg_count,
                    )
            except Exception:
                logger.exception("memory.add background falhou")

        asyncio.create_task(_async_add_memory())
    except Exception:
        logger.exception("agendar memory.add falhou")

    # Langfuse trace (fire-and-forget) — observability cliente
    try:
        from services import langfuse_client

        await langfuse_client.trace_event(
            name="agent_message",
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            conversation_id=conv.id,
            input={"text": text_content[:500], "attachments": len(attachments or [])},
            output={"text": (reply.text or "")[:500]},
            metadata={
                "channel": connector_kind,
                "external_chat_id": external_chat_id,
                "tokens_in": reply.tokens_in,
                "tokens_out": reply.tokens_out,
                "cost_cents": cost_cents,
                "model": reply.model_used,
                "memory_used": bool(memory_block),
                "tool_calls": [c.get("name") for c in (reply.tool_calls_made or [])],
                "brakes_fired": reply.brakes_fired or [],
            },
            # turnos onde o modelo precisou de correção (freio) sobem como WARNING — métrica de saúde
            level="WARNING" if reply.brakes_fired else "DEFAULT",
            latency_ms=reply.latency_ms,
        )
    except Exception:
        pass

    return {
        "status": "ok",
        "agent_id": agent.id,
        "conversation_id": conv.id,
        "tokens_in": reply.tokens_in,
        "tokens_out": reply.tokens_out,
        "latency_ms": reply.latency_ms,
        "memory_used": bool(memory_block),
    }
