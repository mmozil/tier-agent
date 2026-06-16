"""Tier Engine — motor de execução de agente PRÓPRIO do Tier (in-process).

O Tier chama o LLM **in-process**, lendo a config do tenant em `TaLlmProvider`
(provider/modelo/key/fallback/base_url). Sem container de execução externo, sem
dependência de terceiro — mesma superfície de rede do backend (control plane).

Contrato:
    send_message(tenant_id, user_content, db, *, system_override, attachments,
                 agent_id, session_id, use_cache, tools) -> EngineReply

Camadas reaproveitadas do Tier (control plane já existente):
    - llm_cache  : cache exact-match (Redis) — ~80% custo a menos em FAQ
    - pii_redactor: redação LGPD antes do LLM + restauração na resposta
    - TaLlmProvider: config de LLM por tenant (zero hardcode) + cadeia de fallback

Providers suportados:
    - OpenAI-compatible (default): minimax, openai, openrouter, gemini, local, nous,
      e qualquer custom via base_url → POST {base_url}/chat/completions
    - anthropic (nativo): POST https://api.anthropic.com/v1/messages

Tool-use (function calling) é opcional via `tools=` — o loop executa tool calls
contra o registry do Tier (mcp_client/code_executor/etc) e re-injeta o resultado.
Hoje os callers não passam tools (persona-driven), então o default é sem ferramentas.
"""

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.encryption import decrypt
from models import TaFeatureFlag, TaLlmProvider

logger = logging.getLogger(__name__)
settings = get_settings()

# Endpoints default por provider (OpenAI-compatible salvo anthropic).
_DEFAULT_BASE_URL = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com",
    "minimax": "https://api.minimax.io/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "anthropic": "https://api.anthropic.com/v1",
    "nous": "https://inference-api.nousresearch.com/v1",
    "local": "http://localhost:8000/v1",
}
_MAX_TOOL_ITERATIONS = 8  # trava anti-loop no tool-use (multi-serviço: banho+tosa+taxidog)

# Modelo canônico por provider — usado quando a config vem vazia OU com só o nome do
# provider (ex: usuário digita "DeepSeek" no campo modelo). Evita 400 "model not exist".
_DEFAULT_MODEL = {
    "deepseek": "deepseek-chat",
    "minimax": "MiniMax-M2",
    "openai": "gpt-4o",
    "openrouter": "openai/gpt-4o",
    "gemini": "gemini-2.0-flash",
    "anthropic": "claude-haiku-4-5-20251001",
}


def _norm_model(provider: str, model: str | None) -> str:
    """Normaliza o nome do modelo. Vazio ou == nome do provider ("DeepSeek", "deepseek")
    → usa o modelo canônico do provider. Um modelo específico é respeitado."""
    m = (model or "").strip()
    prov = (provider or "").lower()
    if not m or m.lower().replace(" ", "").replace("-", "") == prov.replace("-", ""):
        return _DEFAULT_MODEL.get(prov, m)
    return m

# Modelos de raciocínio (MiniMax-M2, etc.) emitem <think>...</think> na resposta —
# o cliente NÃO pode ver o raciocínio. Removido antes de devolver.
_THINK_RE = re.compile(r"<think>.*?</think>\s*", re.DOTALL | re.IGNORECASE)

# CJK (chinês/japonês/coreano) — MiniMax vaza caracteres orientais esporádicos no pt-BR.
# Cobre BMP (símbolos/kana/CJK unified+ext A/compat/fullwidth/hangul) + plano suplementar
# (Ext B-H, U+20000+). NÃO pega acentos pt-BR nem emoji (emoji fica em U+1F300+, fora destas
# faixas). Usado pra (1) forçar re-resposta em pt-BR e (2) sanitização final defensiva.
_CJK_RE = re.compile(
    "[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿"
    "豈-﫿＀-￯가-힯]"
    "|[\U00020000-\U0003ffff]"
)


def _strip_thinking(text: str) -> str:
    return _THINK_RE.sub("", text or "").strip()


@dataclass
class EngineReply:
    text: str
    audio_url: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    model_used: str | None = None
    raw_response: dict | None = None
    tool_calls_made: list = field(default_factory=list)


# Registry de ferramentas (function calling). Cada handler: (args:dict) -> str.
# Populado por register_tool() — o agent_runtime/playbook registram as do Tier.
_TOOL_REGISTRY: dict[str, Callable[[dict], Awaitable[str]]] = {}
_TOOL_SCHEMAS: list[dict] = []


def register_tool(schema: dict, handler: Callable[[dict], Awaitable[str]]) -> None:
    """Registra uma ferramenta (schema OpenAI function + handler async)."""
    name = schema.get("function", {}).get("name") or schema.get("name")
    if not name:
        raise ValueError("tool schema sem name")
    _TOOL_REGISTRY[name] = handler
    _TOOL_SCHEMAS.append(schema)


async def _load_provider(db: AsyncSession, tenant_id: int) -> TaLlmProvider:
    """Config de LLM do tenant; cai pro default global (tenant_id NULL) se não houver.

    Usa o mais recente (maior id) quando há mais de um ativo — tolera duplicatas
    de config sem estourar (ex: 2 providers globais).
    """
    row = (
        await db.execute(
            select(TaLlmProvider)
            .where(TaLlmProvider.tenant_id == tenant_id, TaLlmProvider.active.is_(True))
            .order_by(TaLlmProvider.priority.asc(), TaLlmProvider.id.desc())
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        row = (
            await db.execute(
                select(TaLlmProvider)
                .where(TaLlmProvider.tenant_id.is_(None), TaLlmProvider.active.is_(True))
                .order_by(TaLlmProvider.id.desc())
                .limit(1)
            )
        ).scalars().first()
    if row is None:
        raise RuntimeError(f"Nenhum TaLlmProvider configurado pra tenant {tenant_id} (nem global)")
    return row


def _base_url(p: TaLlmProvider) -> str:
    return (p.base_url or _DEFAULT_BASE_URL.get(p.provider, "")).rstrip("/")


async def _call_openai_compatible(
    *, base_url: str, api_key: str, model: str, messages: list[dict],
    temperature: float, max_tokens: int, timeout_s: int, tools: list[dict] | None,
) -> dict:
    payload: dict[str, Any] = {"model": model, "messages": messages,
                               "temperature": temperature, "max_tokens": max_tokens}
    if tools:
        payload["tools"] = tools
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout_s) as cli:
        r = await cli.post(f"{base_url}/chat/completions", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"LLM {model} retornou {r.status_code}: {r.text[:300]}")
    return r.json()


async def _call_anthropic(
    *, base_url: str, api_key: str, model: str, messages: list[dict],
    temperature: float, max_tokens: int, timeout_s: int,
) -> dict:
    """Anthropic Messages API → normaliza pro shape OpenAI (choices/usage)."""
    system = "\n".join(m["content"] for m in messages if m.get("role") == "system" and isinstance(m.get("content"), str))
    conv = [m for m in messages if m.get("role") != "system"]
    payload = {"model": model, "system": system, "messages": conv,
               "max_tokens": max_tokens, "temperature": temperature}
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout_s) as cli:
        r = await cli.post(f"{base_url}/messages", json=payload, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Anthropic {model} retornou {r.status_code}: {r.text[:300]}")
    data = r.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    usage = data.get("usage", {})
    return {
        "model": data.get("model", model),
        "choices": [{"message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": usage.get("input_tokens", 0),
                  "completion_tokens": usage.get("output_tokens", 0)},
    }


async def _complete(p: TaLlmProvider, model: str, messages: list[dict], tools: list[dict] | None) -> dict:
    api_key = decrypt(p.api_key_enc)
    base = _base_url(p)
    if p.provider == "anthropic":
        return await _call_anthropic(base_url=base, api_key=api_key, model=model, messages=messages,
                                     temperature=p.temperature, max_tokens=p.max_tokens, timeout_s=p.timeout_s)
    return await _call_openai_compatible(base_url=base, api_key=api_key, model=model, messages=messages,
                                         temperature=p.temperature, max_tokens=p.max_tokens,
                                         timeout_s=p.timeout_s, tools=tools)


async def _complete_with_fallback(p: TaLlmProvider, messages: list[dict], tools: list[dict] | None) -> dict:
    """Tenta o modelo default; se falhar, percorre fallback_chain_json."""
    attempts: list[tuple[str, str]] = [(p.provider, _norm_model(p.provider, p.default_model))]
    for fb in (p.fallback_chain_json or []):
        if isinstance(fb, dict) and fb.get("model"):
            _fp = fb.get("provider", p.provider)
            attempts.append((_fp, _norm_model(_fp, fb["model"])))
    last_err: Exception | None = None
    for prov, model in attempts:
        try:
            # provider de fallback diferente: usa o mesmo registro (key/base) só troca modelo,
            # salvo anthropic que muda o caminho de chamada.
            eff = p
            if prov != p.provider:
                eff = TaLlmProvider(provider=prov, api_key_enc=p.api_key_enc, default_model=model,
                                    base_url=None, temperature=p.temperature, max_tokens=p.max_tokens,
                                    timeout_s=p.timeout_s, fallback_chain_json=[])
            return await _complete(eff, model, messages, tools)
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("tier_engine: modelo %s/%s falhou (%s) — tentando fallback", prov, model, e)
    raise RuntimeError(f"tier_engine: todos os modelos falharam. Último erro: {last_err}")


async def send_message(
    tenant_id: int,
    user_content: str,
    db: AsyncSession,
    *,
    session_id: str | None = None,
    system_override: str | None = None,
    attachments: list | None = None,
    agent_id: int | None = None,
    use_cache: bool = True,
    tools: list[dict] | None = None,
    history: list[dict] | None = None,
) -> EngineReply:
    """Gera a resposta do agente in-process (drop-in do antigo engine_proxy.send_message).

    Multimodal: attachments com kind=image viram content OpenAI Vision. Tool-use:
    se `tools` vier (ou houver tools registradas), roda o loop de function calling.
    `history`: turnos anteriores [{role, content}] pra o modelo manter contexto da
    conversa (senão "nao"/"sim" viram saudação genérica — agente "esquece" o cliente).
    """
    has_attachments = bool(attachments)
    has_history = bool(history)

    # 1. Cache exact-match (pula se há imagem, histórico ou cache off).
    # Conversa com histórico NÃO é cacheável: o mesmo "nao"/"ok" significa coisas
    # diferentes em contextos diferentes — cache exact-match colidiria.
    if use_cache and not has_attachments and not has_history:
        from services import llm_cache

        cached = await llm_cache.get(
            tenant_id=tenant_id, agent_id=agent_id,
            system_prompt=system_override, user_content=user_content,
        )
        if cached:
            logger.info("tier_engine: cache HIT tenant=%s agent=%s", tenant_id, agent_id)
            return EngineReply(text=cached.text, latency_ms=1, model_used=cached.model,
                               raw_response={"_cache_hit": True, "cached_at": cached.cached_at})

    # 2. PII redaction (LGPD, gate por feature flag, default ON)
    pii_mapping = None
    if await _pii_enabled_for_tenant(db, tenant_id):
        from services import pii_redactor

        if system_override:
            system_override, _ = pii_redactor.redact(system_override or "")
        user_content, pii_mapping = pii_redactor.redact(user_content or "")

    # 3. Monta mensagens (system + user, multimodal se houver imagem)
    messages: list[dict] = []
    if system_override:
        messages.append({"role": "system", "content": system_override})
    # Histórico da conversa (turnos anteriores) ANTES do turno atual — dá memória
    # ao modelo. Só roles user/assistant com texto entram.
    for h in history or []:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    image_atts = [a for a in (attachments or [])
                  if getattr(a, "kind", None) == "image" and getattr(a, "url", None)]
    if image_atts:
        parts: list[dict] = []
        if user_content:
            parts.append({"type": "text", "text": user_content})
        for att in image_atts:
            parts.append({"type": "image_url", "image_url": {"url": att.url}})
        messages.append({"role": "user", "content": parts})
    else:
        messages.append({"role": "user", "content": user_content})

    # 4. Chama o LLM (com fallback) + loop de tool-use se houver ferramentas
    provider = await _load_provider(db, tenant_id)

    # Tools = registry global do Tier + federação MCP por agente (TaToolProvider).
    # Só federa no caminho persona-driven (tools=None); se o caller passa tools
    # explícitas (ex: nó de playbook), respeita e não injeta as remotas.
    base_tools: list[dict] = list(tools) if tools is not None else list(_TOOL_SCHEMAS)
    remote_handlers: dict[str, Callable[[dict], Awaitable[str]]] = {}
    if agent_id is not None and tools is None:
        try:
            from services import tool_provider_service

            remote_schemas, remote_handlers = await tool_provider_service.discover_agent_tools(db, agent_id)
            if remote_schemas:
                base_tools = base_tools + remote_schemas
        except Exception:
            logger.exception("tier_engine: descoberta de tool-providers MCP falhou agent=%s", agent_id)
    active_tools = base_tools or None

    started = time.perf_counter()
    tool_calls_made: list = []
    import json as _json
    import re as _re

    # Identidade AO VIVO do petshop: se o agente tem a ferramenta de info do petshop,
    # busca o nome/endereço/telefone REAIS (o que está nas Configurações) e injeta como
    # fonte da verdade no system prompt. Assim renomear o petshop nas configs reflete no
    # agente na hora, sem editar a persona. Só dispara em agentes que têm essa tool (Pet).
    if remote_handlers and messages and messages[0].get("role") == "system":
        _info_handler = next(
            (h for n, h in remote_handlers.items() if n.endswith("pet_info_petshop")), None
        )
        if _info_handler is not None:
            try:
                _raw = await _info_handler({})
                _info = _json.loads(_raw) if isinstance(_raw, str) else (_raw or {})
                _nome = (_info or {}).get("nome")
                if _nome:
                    _linhas = [
                        "# Identidade oficial do petshop (dados AO VIVO das Configurações — fonte da verdade)",
                        f"- Nome oficial: {_nome}",
                    ]
                    _tel = (_info or {}).get("telefone")
                    if _tel:
                        _linhas.append(f"- Telefone: {_tel}")
                    _end = (_info or {}).get("endereco")
                    _end_txt = _end.get("linha") if isinstance(_end, dict) else (_end if isinstance(_end, str) else None)
                    if _end_txt:
                        _linhas.append(f"- Endereço: {_end_txt}")
                    _linhas.append(
                        "Use SEMPRE este nome oficial ao falar do petshop. Se a persona acima citar um "
                        "nome diferente, ele está DESATUALIZADO — vale este."
                    )
                    messages[0]["content"] = f"{messages[0]['content']}\n\n" + "\n".join(_linhas)
            except Exception:
                logger.exception("tier_engine: prefetch pet_info_petshop falhou")

    async def _exec_loop(_data: dict) -> dict:
        """Executa o loop de tool-use a partir de _data até o modelo parar de chamar
        ferramentas (ou estourar o limite). Mutaria `messages`. Devolve o último data."""
        for _ in range(_MAX_TOOL_ITERATIONS):
            ch = (_data.get("choices") or [{}])[0]
            m = ch.get("message", {})
            calls = m.get("tool_calls") or []
            if not calls:
                break
            messages.append(m)
            for call in calls:
                fn = call.get("function", {})
                name = fn.get("name")
                try:
                    args = _json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                handler = _TOOL_REGISTRY.get(name) or remote_handlers.get(name)
                if handler:
                    try:
                        result = await handler(args)
                    except Exception as e:  # noqa: BLE001 — falha de tool NUNCA mata a resposta
                        logger.exception("tier_engine: ferramenta %s falhou", name)
                        result = f"[erro ao executar {name}: {e}]"
                else:
                    result = f"[ferramenta {name} indisponível]"
                tool_calls_made.append({"name": name, "args": args})
                messages.append({"role": "tool", "tool_call_id": call.get("id"), "content": str(result)})
            _data = await _complete_with_fallback(provider, messages, active_tools)
        return _data

    data = await _exec_loop(await _complete_with_fallback(provider, messages, active_tools))

    choice = (data.get("choices") or [{}])[0]
    _final_msg = choice.get("message", {})
    text = _strip_thinking(_final_msg.get("content", "") or "")

    # Freio anti "anuncia e para": o modelo disse que ia ver/verificar mas NÃO chamou
    # nenhuma ferramenta no turno → força a ação UMA vez (modelo ignora a persona às
    # vezes). Pega "deixa eu ver", "um momento", "já te falo", "vou verificar"...
    _ANNOUNCE = _re.compile(
        r"deixa eu (ver|conferir|verificar|confirmar|olhar|checar|dar uma olhada)|um momento|"
        r"j[áa] (te )?(falo|retorno|aviso|respondo|digo)|vou (ver|verificar|checar|confirmar|conferir|consultar)|"
        r"aguarde|s[óo] um (instante|momento|minutinho)|pera[ií]",
        _re.I,
    )
    if active_tools and not tool_calls_made and text and len(text) < 240 and _ANNOUNCE.search(text):
        messages.append({"role": "assistant", "content": text})
        messages.append({
            "role": "user",
            "content": "(sistema) Você disse que ia verificar mas não consultou nada. AJA AGORA: chame a ferramenta certa e responda com o resultado real na mesma mensagem — sem dizer que vai verificar/aguardar.",
        })
        try:
            data = await _exec_loop(await _complete_with_fallback(provider, messages, active_tools))
            _nt = _strip_thinking((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "")
            if _nt:
                text = _nt
        except Exception:
            logger.exception("tier_engine: freio anti-anuncio falhou")

    # Freio anti "inventa / pula consulta": o modelo (1) ofereceu horário sem consultar
    # a agenda (alucina slots, inclusive já passados), ou (2) perguntou porte/raça/nome
    # do pet sem consultar o cadastro (esses dados já estão salvos). Existe ferramenta
    # pra ambos e o modelo deveria ter usado → força a consulta UMA vez. MiniMax ignora
    # a persona; a disciplina precisa morar no motor.
    _OFFERS_SLOT = _re.compile(r"\b\d{1,2}\s*h(?:\s*\d{2})?\b|\b\d{1,2}:\d{2}\b", _re.I)
    _SCHED_CTX = _re.compile(r"hor[áa]rio|dispon[íi]|livre|vaga|encaix|pode ser|agend", _re.I)
    _ASKS_PET = _re.compile(
        r"\b(qual|quais)\b[^?]{0,40}\b(porte|ra[çc]a|nome do (?:seu )?pet|peso)\b"
        r"|\bqual o porte\b|\bporte\b[^?]{0,12}\(\s*p\b",
        _re.I,
    )

    def _called(*subs: str) -> bool:
        return any(any(s in (c.get("name") or "").lower() for s in subs) for c in tool_calls_made)

    # Re-pedido do que o cliente JÁ informou nesta conversa (clássico "mas eu já te passei").
    # Junta o texto das mensagens do cliente e procura CEP/telefone pra devolver ao modelo.
    _user_texts = " ".join(
        m["content"] for m in messages if m.get("role") == "user" and isinstance(m.get("content"), str)
    )
    _ASKS_CEP = _re.compile(r"\bcep\b", _re.I)
    _ASKS_PHONE = _re.compile(r"whats|telefone|n[úu]mero|seu zap|seu contato", _re.I)
    _RE_CEP = _re.compile(r"\b\d{5}-?\d{3}\b")
    _RE_PHONE = _re.compile(r"(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}")
    _asks = "?" in (text or "")
    # Cliente perguntou ATÉ QUE HORAS um profissional trabalha (expediente) — isso é
    # diferente de "tem horário livre". O modelo respondia "não tem horário hoje".
    _USER_ASKS_HOURS = _re.compile(
        r"at[ée]\s+que\s+horas|at[ée]\s+quando|\bexpediente\b|"
        r"que\s+horas\b[^?]*\b(trabalh|atend|sai|fecha|abre|fica)|hor[áa]rio\s+(del[ea]|d[oa]\s+\w+)",
        _re.I,
    )
    # Cliente pergunta sobre um agendamento EXISTENTE (status/horário) — o modelo às vezes
    # "confirma" um agendamento que não existe (alucina do histórico). Tem que conferir a agenda.
    _USER_ASKS_BOOKING = _re.compile(
        r"confirmad|meu(s)?\s+(hor[áa]rio|agendament)|est[áa]\s+(marcad|agendad|confirmad)|"
        r"t[áa]\s+(marcad|confirmad)|tem\s+(algum\s+)?agendament|o\s+(do|da)\s+\w+\s+(est|t[áa]|ficou|continua)",
        _re.I,
    )

    _discipline_msg = None
    if active_tools and text and _OFFERS_SLOT.search(text) and _SCHED_CTX.search(text) and not _called(
        "horario", "disponiv"
    ):
        _discipline_msg = (
            "(sistema) Você ofereceu horário SEM consultar a agenda. Chame AGORA a ferramenta de "
            "horários disponíveis para a data pedida e ofereça SOMENTE horários reais que ainda não "
            "passaram (considere a data e a hora atuais). Nunca invente horários nem ofereça horário passado."
        )
    elif active_tools and text and _ASKS_PET.search(text) and not _called("tutor", "cliente", "historico"):
        _discipline_msg = (
            "(sistema) Você perguntou um dado do pet (porte/raça/nome) que provavelmente já está no "
            "cadastro. Consulte AGORA o cadastro do cliente pelo telefone dele (pet_listar_tutores) e use "
            "porte/raça/nome de lá, sem perguntar. Só pergunte se realmente não existir cadastro."
        )
    elif active_tools and text and _asks and _ASKS_CEP.search(text) and _RE_CEP.search(_user_texts):
        _cep = _RE_CEP.search(_user_texts).group(0)  # type: ignore[union-attr]
        _discipline_msg = (
            f"(sistema) O cliente JÁ informou o CEP nesta conversa: {_cep}. NÃO peça de novo — chame AGORA "
            f"pet_taxidog_cotar com cep_cliente={_cep} e traga a faixa do Taxidog. Se a ferramenta não "
            "conseguir calcular, aí sim confirme com o cliente se ele fica até 3km ou até 7km — UMA vez só."
        )
    elif active_tools and text and _asks and _ASKS_PHONE.search(text) and _RE_PHONE.search(_user_texts):
        _tel = _RE_PHONE.search(_user_texts).group(0).strip()  # type: ignore[union-attr]
        _discipline_msg = (
            f"(sistema) O cliente JÁ informou o número nesta conversa: {_tel}. NÃO peça de novo — use esse "
            "número pra cadastrar/buscar o cliente e siga (se não houver cadastro, cadastre AGORA com o nome "
            "do WhatsApp + esse número, sem ficar perguntando)."
        )
    elif active_tools and text and _USER_ASKS_BOOKING.search(user_content or "") and not _called("agenda", "historico"):
        _discipline_msg = (
            "(sistema) O cliente perguntou sobre um agendamento EXISTENTE (se está confirmado / qual o horário). "
            "NÃO afirme nem invente agendamento. Consulte AGORA a agenda real (pet_consultar_agenda do dia ou "
            "pet_historico_pet do pet) e responda SÓ com o que existir de verdade. Se não houver agendamento "
            "pra esse pet, diga que não encontrou e ofereça agendar — nunca confirme um horário/valor que você não verificou."
        )
    elif active_tools and text and _USER_ASKS_HOURS.search(user_content or "") and not _called("profission"):
        _discipline_msg = (
            "(sistema) O cliente perguntou o HORÁRIO/expediente de um profissional (até que horas atende hoje) "
            "— isso NÃO é 'tem horário livre'. Consulte AGORA pet_listar_profissionais (campo escala_texto) e "
            "responda até que horas o profissional atende hoje. Se ele atende mas o serviço não cabe hoje, "
            "EXPLIQUE o porquê (ex.: já tem agendamento até tal hora; serviço mais curto ainda pode caber) — "
            "nunca diga só que 'fechou tudo'."
        )
    if _discipline_msg:
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": _discipline_msg})
        try:
            data = await _exec_loop(await _complete_with_fallback(provider, messages, active_tools))
            _nt = _strip_thinking((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "")
            if _nt:
                text = _nt
        except Exception:
            logger.exception("tier_engine: freio de disciplina de ferramenta falhou")

    # Freio de UPSELL: fechou um agendamento mas NÃO ofereceu adicionais. Upsell é
    # disciplina de VENDA e o MiniMax não a segue pela persona → impõe no motor. Só dispara
    # se a tool de criação devolveu upsell_disponivel com algo a oferecer (taxidog ou extras)
    # → não re-oferece o que já está no agendamento nem inventa adicional inexistente.
    _OFFERS_UPSELL = _re.compile(
        r"taxidog|leva[- ]e[- ]traz|corte de unha|unhas|hidrata|desembara[çc]|extra|adicional|"
        r"quer (incluir|aproveitar|adicionar)",
        _re.I,
    )

    def _tem_upsell_pendente() -> bool:
        for _m in reversed(messages):
            if _m.get("role") != "tool":
                continue
            _c = _m.get("content") or ""
            if "upsell_disponivel" not in _c:
                continue
            if _re.search(r'"taxidog"\s*:\s*true', _c):
                return True
            _ex = _re.search(r'"extras"\s*:\s*\[(.*?)\]', _c, _re.S)
            return bool(_ex and _ex.group(1).strip())
        return False

    if (
        active_tools and text and _called("criar_agendamento")
        and not _OFFERS_UPSELL.search(text) and _tem_upsell_pendente()
    ):
        messages.append({"role": "assistant", "content": text})
        messages.append({
            "role": "user",
            "content": (
                "(sistema) Você fechou o agendamento mas não ofereceu nada a mais. ANTES de encerrar, "
                "veja o campo upsell_disponivel no resultado da ferramenta de criação e ofereça, de forma "
                "curta e gentil (1 frase), só os adicionais e o Taxidog (leva-e-traz) que AINDA NÃO estão "
                "neste agendamento. Não re-ofereça o que já está incluído. Sem pressão."
            ),
        })
        try:
            data = await _exec_loop(await _complete_with_fallback(provider, messages, active_tools))
            _nt = _strip_thinking((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "")
            if _nt:
                text = _nt
        except Exception:
            logger.exception("tier_engine: freio de upsell falhou")

    # Freio de IDIOMA: MiniMax às vezes vaza caracteres CJK no meio do pt-BR. Re-roda UMA
    # vez forçando português (a sanitização final abaixo é a 2ª camada). Sem gate de tools:
    # o vazamento ocorre também em conversa persona-driven pura.
    if text and _CJK_RE.search(text):
        messages.append({"role": "assistant", "content": text})
        messages.append({
            "role": "user",
            "content": (
                "(sistema) Sua resposta tinha caracteres de outro idioma (chinês/japonês/coreano). "
                "Reescreva a MESMA resposta 100% em português do Brasil, sem nenhum caractere CJK, "
                "mantendo conteúdo e tom. Não comente sobre isto."
            ),
        })
        try:
            data = await _exec_loop(await _complete_with_fallback(provider, messages, active_tools))
            _nt = _strip_thinking((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "")
            if _nt:
                text = _nt
        except Exception:
            logger.exception("tier_engine: freio de idioma (CJK) falhou")

    # Rede de segurança: pendente de tool_call OU sem texto → fecho SEM ferramentas
    # (senão o agente fica MUDO depois de executar ações). Tools já estão em messages.
    _fm = (data.get("choices") or [{}])[0].get("message", {})
    if _fm.get("tool_calls") or not text:
        try:
            data = await _complete_with_fallback(provider, messages, None)
            text = _strip_thinking((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "")
        except Exception:
            logger.exception("tier_engine: fecho final sem ferramentas falhou")
    # 2ª camada anti-CJK: remove caractere oriental residual ANTES do guard de texto vazio
    # (se sobrar só CJK, vira "" e cai no fallback — nunca manda balão vazio nem chinês).
    if text:
        text = _CJK_RE.sub("", text).strip()
    if not text:
        text = "Prontinho! 🐾 Me avisa se precisar de mais alguma coisa."
    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = data.get("usage", {})

    # 5. Restaura PII na resposta
    if pii_mapping:
        from services import pii_redactor

        text = pii_redactor.restore(text, pii_mapping)

    # 6. Salva no cache (nunca quando há histórico — resposta é contextual)
    if use_cache and not has_attachments and not has_history and text:
        from services import llm_cache

        await llm_cache.put(
            tenant_id=tenant_id, agent_id=agent_id, system_prompt=system_override,
            user_content=user_content, reply_text=text,
            tokens_in=usage.get("prompt_tokens", 0), tokens_out=usage.get("completion_tokens", 0),
            model=data.get("model"),
        )

    return EngineReply(
        text=text,
        tokens_in=usage.get("prompt_tokens", 0),
        tokens_out=usage.get("completion_tokens", 0),
        latency_ms=latency_ms,
        model_used=data.get("model"),
        raw_response=data,
        tool_calls_made=tool_calls_made,
    )


async def _pii_enabled_for_tenant(db: AsyncSession, tenant_id: int) -> bool:
    """Feature flag enable_pii_redaction (tenant > global). Default ON (LGPD)."""
    try:
        row = (
            await db.execute(
                select(TaFeatureFlag).where(
                    TaFeatureFlag.key == "enable_pii_redaction",
                    TaFeatureFlag.escopo == "tenant",
                    TaFeatureFlag.escopo_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = (
                await db.execute(
                    select(TaFeatureFlag).where(
                        TaFeatureFlag.key == "enable_pii_redaction",
                        TaFeatureFlag.escopo == "global",
                    )
                )
            ).scalar_one_or_none()
        if row is None:
            return True
        return bool(row.enabled and (str(row.value or "true").lower() in ("true", "1", "on", "yes")))
    except Exception:
        logger.exception("pii feature flag lookup falhou tenant=%s — default OFF", tenant_id)
        return False
