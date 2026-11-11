"""Registro de atividades — QUEM fez O QUÊ, QUANDO e DE ONDE, em toda ação do sistema (11/11/2026).

Incidente do CCDA (11/11/2026, 11:20): o número de teste do agente 26 foi refeito por QR e
removido pela tela Canais, e o sistema só sabia a hora — não a pessoa. O aviso «Canal removido»
não guardava o autor e o proxy não tem registro de acesso. Pedido do dono: «temos que ter log de
tudo que fizerem no sistema, todos os usuários».

Como funciona:
- O middleware `RegistroDeAtividade` (ASGI puro) olha TODA requisição que muda algo
  (POST/PUT/PATCH/DELETE em /api/v1) feita por um usuário logado, e entrar/sair do sistema.
  A identidade sai do próprio token (sem ir ao banco), ou do cookie que o login devolve.
- A gravação NÃO acontece na requisição: o evento vai para uma fila e UM gravador por processo
  grava em lote (até 200 por vez). Nunca segura conexão do pedido — lição do registro de acesso,
  que esgotou o pool abrindo uma 2ª sessão por pedido (ver `acesso_conversa`). Fila cheia (5.000)
  descarta com aviso no log; a tela nunca fica lenta por causa disso.
- A rota pode ENRIQUECER o evento com `request.state.atividade = {"alvo": ...}` — usado onde o
  alvo some depois da ação (o número removido não existe mais para ser lido depois).

O que NÃO entra: conteúdo de mensagem, corpo de requisição, senha, token. Só a ação, o alvo (id),
a pessoa, o resultado (código HTTP), o endereço de origem e o navegador. Webhooks, chat público
e chamadas servidor-a-servidor ficam de fora (não há pessoa) — a entrada pelo ERP é gravada na
própria rota de SSO.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import UTC, datetime
from http.cookies import SimpleCookie

from jose import JWTError, jwt

from core.config import get_settings

logger = logging.getLogger(__name__)
_settings = get_settings()

PREFIXO = "/api/v1"
METODOS = {"POST", "PUT", "PATCH", "DELETE"}
# Sem pessoa por trás (máquina chamando máquina) ou visitante anônimo.
FORA = (
    "/webhooks",
    "/public/",
    "/internal",
    "/integrations/",
    "/tool-providers/oauth/callback",
    "/health",
)
# Rotas de entrada: gravadas mesmo SEM token (a tentativa que falhou também conta).
ENTRADA = {"/auth/login", "/auth/google", "/auth/signup"}

FILA_MAX = 5000
LOTE_MAX = 200

# ── Nome de cada ação em português ──────────────────────────────────────────────────────
# (método ou None = qualquer, padrão da rota sem o /api/v1, rótulo). A 1ª que casar vence.
ROTULOS: list[tuple[str | None, str, str]] = [
    ("POST", r"^/auth/login$", "Entrou no sistema"),
    ("POST", r"^/auth/google$", "Entrou com Google"),
    ("POST", r"^/auth/signup$", "Criou a conta"),
    ("POST", r"^/auth/logout$", "Saiu do sistema"),
    ("PATCH", r"^/auth/me$", "Alterou o próprio perfil"),
    ("POST", r"^/auth/me/avatar$", "Trocou a foto do perfil"),
    ("DELETE", r"^/auth/me/avatar$", "Tirou a foto do perfil"),
    ("POST", r"^/auth/me/atendimento/fechar$", "Fechou o Atendimento"),
    ("POST", r"^/auth/me/atendimento/abrir$", "Reabriu o Atendimento"),
    # Números e canais
    ("POST", r"^/connectors/whatsapp/provision$", "Conectou número por QR"),
    ("POST", r"^/connectors/whatsapp-cloud/onboard$", "Conectou WhatsApp oficial"),
    ("POST", r"^/connectors/whatsapp-cloud/send-template$", "Enviou modelo pela API oficial"),
    ("POST", r"^/whatsapp-oficial/modelos$", "Criou modelo de mensagem (oficial)"),
    ("DELETE", r"^/whatsapp-oficial/modelos$", "Apagou modelo de mensagem (oficial)"),
    ("POST", r"^/whatsapp-oficial/iniciar-conversa$", "Iniciou conversa com modelo (oficial)"),
    ("POST", r"^/connectors/\d+/connect$", "Abriu o QR do número"),
    ("POST", r"^/connectors/\d+/disconnect$", "Desconectou número"),
    ("DELETE", r"^/connectors/\d+$", "Removeu número"),
    ("PUT", r"^/connectors/\d+/ia$", "Ligou ou desligou a IA do número"),
    ("PUT", r"^/connectors/\d+/ia-horario$", "Mudou o horário da IA do número"),
    ("PUT", r"^/connectors/\d+/assinatura$", "Mudou a assinatura do número"),
    ("PUT", r"^/connectors/\d+/member$", "Mudou a dona do número"),
    ("POST", r"^/connectors/\d+/membros/\d+$", "Pôs pessoa no número"),
    ("DELETE", r"^/connectors/\d+/membros/\d+$", "Tirou pessoa do número"),
    ("POST", r"^/connectors/", "Conectou canal"),
    # Conversas
    ("POST", r"^/conversations/\d+/reply$", "Respondeu na conversa"),
    ("POST", r"^/conversations/\d+/reply-anexo$", "Enviou anexo na conversa"),
    ("POST", r"^/conversations/\d+/note$", "Escreveu nota interna"),
    ("POST", r"^/conversations/\d+/handoff$", "Assumiu a conversa (pausou a IA)"),
    ("POST", r"^/conversations/\d+/resume$", "Devolveu a conversa à IA"),
    ("POST", r"^/conversations/\d+/resolve$", "Resolveu a conversa"),
    ("PUT", r"^/conversations/\d+/assign$", "Atribuiu a conversa"),
    ("PUT", r"^/conversations/\d+/team$", "Mudou o time da conversa"),
    ("PUT", r"^/conversations/\d+/tags$", "Mudou as etiquetas"),
    ("PUT", r"^/conversations/\d+/priority$", "Mudou a prioridade"),
    ("POST", r"^/conversations/\d+/snooze$", "Adiou a conversa"),
    ("POST", r"^/conversations/\d+/unsnooze$", "Tirou a conversa do adiamento"),
    ("POST", r"^/conversations/\d+/mensagens/\d+/editar$", "Editou mensagem enviada"),
    ("POST", r"^/conversations/\d+/mensagens/\d+/reacao$", "Reagiu a uma mensagem"),
    ("POST", r"^/conversations/\d+/enviar-crm$", "Enviou a conversa ao CRM"),
    ("POST", r"^/conversations/\d+/crm/tarefas$", "Criou tarefa no CRM"),
    ("DELETE", r"^/conversations/\d+$", "Apagou a conversa"),
    ("POST", r"^/conversations/bulk-delete$", "Apagou conversas em lote"),
    ("POST", r"^/conversations/iniciar$", "Iniciou conversa nova"),
    # Agentes
    ("POST", r"^/agents$", "Criou agente"),
    ("POST", r"^/agents/seed/", "Criou agente a partir de modelo"),
    ("PATCH", r"^/agents/\d+$", "Alterou agente"),
    ("DELETE", r"^/agents/\d+$", "Apagou agente"),
    ("POST", r"^/agents/\d+/toggle-active$", "Ligou ou desligou agente"),
    ("POST", r"^/agents/\d+/playground$", "Testou o agente no painel"),
    ("DELETE", r"^/agents/memories/\d+$", "Apagou memória de contato"),
    (None, r"^/agents/\d+/tool-providers", "Mudou integração do agente"),
    (None, r"^/agents/\d+/skills", "Mexeu nas habilidades do agente"),
    # Base de conhecimento
    ("POST", r"^/knowledge/upload$", "Enviou documento à base"),
    ("POST", r"^/knowledge/from-feedback$", "Ensinou o agente por uma resposta"),
    ("DELETE", r"^/knowledge/\d+$", "Apagou documento da base"),
    ("POST", r"^/knowledge/(\d+/reindex|reindex-all)$", "Reindexou a base"),
    # Equipe
    ("POST", r"^/team/members$", "Adicionou pessoa à equipe"),
    ("PUT", r"^/team/members/\d+$", "Alterou pessoa da equipe"),
    ("DELETE", r"^/team/members/\d+$", "Removeu pessoa da equipe"),
    ("POST", r"^/team/online$", "Ficou online ou offline"),
    ("POST", r"^/team/teams$", "Criou time"),
    ("DELETE", r"^/team/teams/\d+$", "Apagou time"),
    ("POST", r"^/team/invite/[^/]+/accept$", "Aceitou convite da equipe"),
    # Configurações
    (None, r"^/llm-providers", "Mudou provedor de IA"),
    (None, r"^/embedding-providers", "Mudou provedor de embedding"),
    (None, r"^/playbooks", "Mudou fluxo"),
    (None, r"^/macros/\d+/apply$", "Aplicou macro"),
    (None, r"^/macros", "Mudou macro"),
    (None, r"^/canned-responses", "Mudou resposta pronta"),
    (None, r"^/notifications", "Mexeu nos avisos"),
    (None, r"^/tenants", "Mudou configuração da empresa"),
    (None, r"^/containers", "Mexeu no motor do agente"),
    (None, r"^/(billing|tier-pay)", "Mexeu na cobrança"),
    (None, r"^/secops", "Mexeu na segurança"),
    (None, r"^/feature-flags", "Mudou recurso liga/desliga"),
    (None, r"^/mcp", "Ação pela integração MCP"),
]
_ROTULOS = [(m, re.compile(p), r) for m, p, r in ROTULOS]

# Recurso do 1º pedaço da rota → nome do alvo («número #51», «conversa #812»).
RECURSOS = {
    "connectors": "número",
    "conversations": "conversa",
    "agents": "agente",
    "knowledge": "documento",
    "playbooks": "fluxo",
    "macros": "macro",
    "canned-responses": "resposta pronta",
    "llm-providers": "provedor de IA",
    "embedding-providers": "provedor de embedding",
    "notifications": "aviso",
    "tenants": "empresa",
    "containers": "motor",
}
_VERBO = {"POST": "Executou", "PUT": "Alterou", "PATCH": "Alterou", "DELETE": "Apagou"}


def rotulo(metodo: str, rota: str) -> str:
    """Nome da ação em português. `rota` sem o prefixo /api/v1."""
    for m, padrao, nome in _ROTULOS:
        if (m is None or m == metodo) and padrao.search(rota):
            return nome
    partes = [p for p in rota.split("/") if p]
    recurso = RECURSOS.get(partes[0], partes[0]) if partes else "sistema"
    return f"{_VERBO.get(metodo, metodo)} {recurso}"[:64]


def recurso_e_id(rota: str) -> tuple[str | None, int | None]:
    """Recurso e o 1º número da rota — o alvo da ação («conversa», 812)."""
    partes = [p for p in rota.split("/") if p]
    if not partes:
        return None, None
    rid = next((int(p) for p in partes[1:] if p.isdigit()), None)
    # /team/members/7 → a pessoa 7; /connectors/51/membros/9 → o número 51
    if partes[0] == "team" and len(partes) > 1 and partes[1] == "members":
        return "pessoa", rid
    return RECURSOS.get(partes[0], partes[0]), rid


def identidade(token: str | None) -> dict | None:
    """Quem está por trás do token — sem ir ao banco e sem nunca levantar erro."""
    if not token:
        return None
    try:
        p = jwt.decode(token, _settings.jwt_secret, algorithms=[_settings.jwt_algorithm])
    except JWTError:
        return None
    except Exception:  # noqa: BLE001
        return None
    tenant_id = p.get("tenant_id")
    if tenant_id is None:
        try:
            tenant_id = int(p.get("sub"))
        except (TypeError, ValueError):
            tenant_id = None
    return {
        "tenant_id": tenant_id,
        "member_id": p.get("member_id"),
        "nome": p.get("member_name"),
        "email": (p.get("email") or "")[:200],
        "papel": p.get("role") or ("owner" if not p.get("member_id") else None),
    }


def quem(ident: dict | None, email_tentado: str | None = None) -> str:
    """O texto do «Quem» — nome da pessoa; dono sem nome = «Dono da conta (e-mail)»."""
    if not ident:
        return (email_tentado or "Sem login")[:255]
    if ident.get("nome"):
        return str(ident["nome"])[:255]
    if ident.get("member_id"):
        return f"Pessoa #{ident['member_id']}"
    return f"Dono da conta ({ident.get('email') or 'sem e-mail'})"[:255]


# ── Fila e gravador ─────────────────────────────────────────────────────────────────────
_fila: asyncio.Queue | None = None
_gravador: asyncio.Task | None = None


def registrar(evento: dict) -> None:
    """Põe o evento na fila. Nunca espera, nunca levanta erro."""
    global _fila
    try:
        # A hora é a da AÇÃO, não a da gravação (o lote pode sair segundos depois).
        # UTC sem fuso, igual ao `now()` do banco nas outras tabelas.
        evento.setdefault("quando", datetime.now(UTC).replace(tzinfo=None))
        if _fila is None:
            _fila = asyncio.Queue(maxsize=FILA_MAX)
        _fila.put_nowait(evento)
    except asyncio.QueueFull:
        logger.warning("registro de atividade: fila cheia — evento descartado (%s)", evento.get("acao"))
    except Exception:  # noqa: BLE001
        logger.warning("registro de atividade: falhou ao enfileirar", exc_info=True)


def registrar_acao(
    *,
    ident: dict | None,
    acao: str,
    alvo: str | None = None,
    detalhe: dict | None = None,
    email_tentado: str | None = None,
) -> None:
    """Atalho para as rotas gravarem uma ação que o middleware não vê (ex.: entrada pelo ERP)."""
    registrar(
        {
            "tenant_id": (ident or {}).get("tenant_id"),
            "quem": quem(ident, email_tentado),
            "acao": acao[:64],
            "alvo": (alvo or "")[:255] or None,
            "detalhe": {
                "member_id": (ident or {}).get("member_id"),
                "email": (ident or {}).get("email") or email_tentado,
                "papel": (ident or {}).get("papel"),
                **(detalhe or {}),
            },
            "email_tentado": email_tentado,
        }
    )


async def _gravar(lote: list[dict]) -> None:
    from sqlalchemy import text

    from core.db import SessionLocal

    async with SessionLocal() as db:
        # Tentativa de entrada sem token: acha a empresa pelo e-mail, para o dono ver
        # quem tentou entrar na conta dele.
        for ev in lote:
            if ev.get("tenant_id") is None and ev.get("email_tentado"):
                r = await db.execute(
                    text(
                        "SELECT tenant_id FROM ta_member WHERE lower(email) = :e"
                        " UNION ALL SELECT id FROM ta_tenant WHERE lower(email) = :e LIMIT 1"
                    ),
                    {"e": ev["email_tentado"].strip().lower()},
                )
                ev["tenant_id"] = r.scalar()
        await db.execute(
            text(
                "INSERT INTO ta_audit_log (tenant_id, actor, action, target, payload_json, created_at)"
                " VALUES (:t, :q, :a, :alvo, CAST(:d AS JSON), :quando)"
            ),
            [
                {
                    "t": ev.get("tenant_id"),
                    "q": ev.get("quem") or "Sem login",
                    "a": (ev.get("acao") or "Ação")[:64],
                    "alvo": ev.get("alvo"),
                    "d": json.dumps(ev.get("detalhe") or {}, ensure_ascii=False, default=str),
                    "quando": ev.get("quando"),
                }
                for ev in lote
            ],
        )
        await db.commit()


async def _laco() -> None:
    assert _fila is not None
    while True:
        ev = await _fila.get()
        lote = [ev]
        while len(lote) < LOTE_MAX:
            try:
                lote.append(_fila.get_nowait())
            except asyncio.QueueEmpty:
                break
        try:
            await _gravar(lote)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — o registro nunca derruba o sistema
            logger.warning("registro de atividade: lote de %s não gravado", len(lote), exc_info=True)
            await asyncio.sleep(2)


def iniciar() -> None:
    """Liga o gravador (1 por processo). Chamado no startup."""
    global _fila, _gravador
    if _fila is None:
        _fila = asyncio.Queue(maxsize=FILA_MAX)
    if _gravador is None or _gravador.done():
        _gravador = asyncio.create_task(_laco())


async def parar() -> None:
    """Grava o que sobrou na fila antes de desligar (deploy não perde as últimas ações)."""
    global _gravador
    if _fila is not None and not _fila.empty():
        resto = []
        while not _fila.empty():
            resto.append(_fila.get_nowait())
        try:
            await _gravar(resto)
        except Exception:  # noqa: BLE001
            logger.warning("registro de atividade: %s eventos perdidos no desligamento", len(resto))
    if _gravador is not None:
        _gravador.cancel()
        _gravador = None


# ── Middleware ──────────────────────────────────────────────────────────────────────────
def _cabecalhos(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}


def _token_do_pedido(h: dict[str, str]) -> str | None:
    auth = h.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1]
    if "cookie" in h:
        c = SimpleCookie()
        try:
            c.load(h["cookie"])
        except Exception:  # noqa: BLE001
            return None
        for nome in ("ta_session", "tier_session"):
            if nome in c:
                return c[nome].value
    return None


def _ip(scope, h: dict[str, str]) -> str | None:
    ip = h.get("cf-connecting-ip") or (h.get("x-forwarded-for") or "").split(",")[0].strip() or h.get("x-real-ip")
    if not ip and scope.get("client"):
        ip = scope["client"][0]
    return (ip or None) and ip[:64]


class RegistroDeAtividade:
    """ASGI puro (sem BaseHTTPMiddleware): não mexe em resposta em fluxo nem atrasa a tela."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        metodo = scope.get("method", "")
        caminho = scope.get("path", "")
        if metodo not in METODOS or not caminho.startswith(PREFIXO + "/"):
            return await self.app(scope, receive, send)
        rota = caminho[len(PREFIXO) :]
        if rota.startswith(FORA):
            return await self.app(scope, receive, send)

        h = _cabecalhos(scope)
        ident = identidade(_token_do_pedido(h))
        entrada = rota in ENTRADA
        if ident is None and not entrada:
            # Sem login não há pessoa — a própria rota responde 401; nada a registrar.
            return await self.app(scope, receive, send)

        inicio = time.monotonic()
        estado = {"status": 500, "cookie_token": None}
        email_tentado: list[str] = []

        recv = receive
        if rota == "/auth/login":
            # Só o e-mail (nunca a senha): quem tentou entrar, inclusive quando falha.
            corpo = bytearray()

            async def recv():  # type: ignore[no-redef]
                msg = await receive()
                if msg.get("type") == "http.request" and len(corpo) < 4096:
                    corpo.extend(msg.get("body") or b"")
                    if not msg.get("more_body"):
                        try:
                            e = (json.loads(bytes(corpo) or b"{}").get("email") or "").strip().lower()
                            if e:
                                email_tentado.append(e[:200])
                        except Exception:  # noqa: BLE001
                            pass
                return msg

        async def _send(msg):
            if msg.get("type") == "http.response.start":
                estado["status"] = msg.get("status", 500)
                if entrada or rota == "/auth/logout":
                    for k, v in msg.get("headers") or []:
                        if k.lower() == b"set-cookie" and v.startswith(b"ta_session="):
                            val = v.split(b";", 1)[0].split(b"=", 1)[1].decode("latin-1")
                            if val:
                                estado["cookie_token"] = val
            await send(msg)

        try:
            await self.app(scope, recv, _send)
        finally:
            try:
                status = estado["status"]
                quem_fez = ident or identidade(estado["cookie_token"])
                acao = rotulo(metodo, rota)
                if entrada and status >= 400:
                    acao = "Tentou entrar (recusado)"
                recurso, rid = recurso_e_id(rota)
                extra = (scope.get("state") or {}).get("atividade") or {}
                alvo = extra.get("alvo") or (f"{recurso} #{rid}" if recurso and rid is not None else None)
                registrar(
                    {
                        "tenant_id": (quem_fez or {}).get("tenant_id"),
                        "quem": quem(quem_fez, email_tentado[0] if email_tentado else None),
                        "acao": acao,
                        "alvo": alvo,
                        "email_tentado": email_tentado[0] if (email_tentado and not quem_fez) else None,
                        "detalhe": {
                            "member_id": (quem_fez or {}).get("member_id"),
                            "email": (quem_fez or {}).get("email") or (email_tentado[0] if email_tentado else None),
                            "papel": (quem_fez or {}).get("papel"),
                            "metodo": metodo,
                            "rota": rota[:200],
                            "recurso": recurso,
                            "recurso_id": rid,
                            "status": status,
                            "ms": int((time.monotonic() - inicio) * 1000),
                            "ip": _ip(scope, h),
                            "navegador": (h.get("user-agent") or "")[:200] or None,
                            **{k: v for k, v in extra.items() if k != "alvo"},
                        },
                    }
                )
            except Exception:  # noqa: BLE001 — o registro nunca derruba o pedido
                logger.warning("registro de atividade: evento não montado %s %s", metodo, rota, exc_info=True)
