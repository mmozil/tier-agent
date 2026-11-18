"""Trocar e redefinir a senha do Tier Agent com CÓDIGO no e-mail (18/11/2026).

Pedido do dono: «ter essa opção lá dentro do Tier Agent, com a confirmação do e-mail» (o Augusto
queria trocar a senha e não havia onde; o «Esqueceu a senha?» do login apontava para «#»).

Dois caminhos, o mesmo código:
- `trocar` — logado, em Meu perfil: senha atual (se a conta tem) + nova → código → confirma.
  A nova senha já vai guardada (só o hash) junto do código: o que se confirma é ESTA troca.
- `esqueci` — no login, deslogado: e-mail → código → nova senha.

Regras: código de 6 dígitos, vale 15 min, 5 tentativas (na 5ª errada ele morre), um novo só depois de
60 s. Guardado no Redis só como HMAC (com o segredo do JWT) — quem lê o Redis não vê o código.
A conta é a do LOGIN: dono (`ta_tenant`) primeiro, depois membro ativo — a mesma ordem de `/auth/login`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from core.config import get_settings

VALIDADE_S = 15 * 60
ESPERA_REENVIO_S = 60
MAX_TENTATIVAS = 5
SENHA_MIN = 8
SENHA_MAX = 128

TROCAR = "trocar"
ESQUECI = "esqueci"


class ErroDeSenha(ValueError):
    """Pedido recusado — a rota devolve `http` com a mensagem."""

    def __init__(self, mensagem: str, http: int = 422):
        super().__init__(mensagem)
        self.http = http


# ───────────────────────── regras puras ─────────────────────────


def validar_nova(senha: str | None) -> str:
    s = senha or ""
    if len(s) < SENHA_MIN:
        raise ErroDeSenha(f"A nova senha precisa de pelo menos {SENHA_MIN} caracteres")
    if len(s) > SENHA_MAX:
        raise ErroDeSenha(f"A nova senha pode ter no máximo {SENHA_MAX} caracteres")
    if not s.strip():
        raise ErroDeSenha("A nova senha não pode ser só espaços")
    return s


def gerar_codigo() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def mascarar(email: str) -> str:
    """«augusto@ccda.com.br» → «aug…@ccda.com.br»."""
    if "@" not in (email or ""):
        return email or ""
    u, d = email.split("@", 1)
    return f"{u[:3]}…@{d}"


def _hash(codigo: str, email: str) -> str:
    chave = get_settings().jwt_secret.encode()
    return hmac.new(chave, f"{email.lower()}|{codigo}".encode(), hashlib.sha256).hexdigest()


def _chave(email: str) -> str:
    return f"ta:senha:{email.strip().lower()}"


def _chave_espera(email: str) -> str:
    return f"ta:senha:espera:{email.strip().lower()}"


# ───────────────────────── Redis (o teste troca) ─────────────────────────


async def _redis():
    import redis.asyncio as redis_async

    return redis_async.from_url(get_settings().redis_url, decode_responses=True)


async def pedir(email: str, motivo: str, nova_hash: str | None = None) -> str:
    """Gera e guarda o código deste e-mail (o anterior deixa de valer). Devolve o código para o
    e-mail — nunca para a tela. `ErroDeSenha(429)` se pediu outro há menos de 60 s."""
    r = await _redis()
    try:
        if not await r.set(_chave_espera(email), "1", ex=ESPERA_REENVIO_S, nx=True):
            espera = await r.ttl(_chave_espera(email))
            raise ErroDeSenha(f"Aguarde {max(1, int(espera or 1))} s para pedir outro código", 429)
        codigo = gerar_codigo()
        dado = {
            "cod": _hash(codigo, email),
            "motivo": motivo,
            "nova": nova_hash,
            "tentativas": 0,
            "em": int(time.time()),
        }
        await r.set(_chave(email), json.dumps(dado), ex=VALIDADE_S)
        return codigo
    finally:
        await r.aclose()


async def esquecer(email: str) -> None:
    """Apaga o código e a espera (o e-mail não saiu: a pessoa pode pedir de novo na hora)."""
    r = await _redis()
    try:
        await r.delete(_chave(email), _chave_espera(email))
    finally:
        await r.aclose()


async def conferir(email: str, codigo: str, motivo: str) -> dict:
    """Confere o código. Certo → devolve o que foi guardado e apaga (vale UMA vez). Errado → conta a
    tentativa; na 5ª o código morre. Sem código/vencido/de outro caminho → recusa."""
    codigo = "".join(ch for ch in (codigo or "") if ch.isdigit())
    r = await _redis()
    try:
        bruto = await r.get(_chave(email))
        if not bruto:
            raise ErroDeSenha("Código vencido ou inexistente — peça um novo", 410)
        dado = json.loads(bruto)
        if dado.get("motivo") != motivo:
            raise ErroDeSenha("Este código é de outro pedido — peça um novo", 410)
        if len(codigo) == 6 and hmac.compare_digest(dado.get("cod") or "", _hash(codigo, email)):
            await r.delete(_chave(email))
            return dado
        dado["tentativas"] = int(dado.get("tentativas") or 0) + 1
        restam = MAX_TENTATIVAS - dado["tentativas"]
        if restam <= 0:
            await r.delete(_chave(email))
            raise ErroDeSenha("Código errado 5 vezes — peça um novo", 429)
        ttl = await r.ttl(_chave(email))
        await r.set(_chave(email), json.dumps(dado), ex=max(1, int(ttl or 1)))
        raise ErroDeSenha(f"Código errado. Restam {restam} tentativa{'s' if restam > 1 else ''}", 422)
    finally:
        await r.aclose()


# ───────────────────────── os e-mails ─────────────────────────


def _pagina(titulo: str, corpo_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{titulo}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 0"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e8e8eb">
<tr><td style="padding:28px 32px">
<div style="font-size:13px;color:#8a94a7;margin-bottom:16px">Tier Agent</div>
{corpo_html}
<div style="margin-top:28px;font-size:12px;color:#8a94a7;line-height:1.6">E-mail automático — não precisa responder.</div>
</td></tr></table></td></tr></table></body></html>"""


def email_codigo(codigo: str, motivo: str) -> tuple[str, str, str]:
    """(assunto, html, texto) do código."""
    acao = "trocar a senha" if motivo == TROCAR else "criar uma nova senha"
    assunto = f"Seu código para {acao} no Tier Agent: {codigo}"
    texto = (
        f"Seu código para {acao} no Tier Agent é {codigo}.\n"
        "Ele vale por 15 minutos.\n\n"
        "Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma."
    )
    html = _pagina(
        assunto,
        f"""<div style="font-size:16px;color:#262626;line-height:1.5">Seu código para {acao}:</div>
<div style="margin:16px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#003083">{codigo}</div>
<div style="font-size:14px;color:#4a5568;line-height:1.6">Ele vale por <b>15 minutos</b>.<br>
Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</div>""",
    )
    return assunto, html, texto


def email_trocada(quando: datetime | None = None) -> tuple[str, str, str]:
    """(assunto, html, texto) do aviso de que a senha mudou."""
    q = (quando or datetime.now(ZoneInfo("UTC"))).astimezone(ZoneInfo("America/Sao_Paulo"))
    hora = f"{q:%d/%m/%Y} às {q:%H:%M}"
    assunto = "Sua senha do Tier Agent foi alterada"
    texto = (
        f"A senha da sua conta no Tier Agent foi alterada em {hora} (horário de Brasília).\n\n"
        "Se não foi você, use «Esqueceu a senha?» na tela de login para criar outra e avise o responsável pela conta."
    )
    html = _pagina(
        assunto,
        f"""<div style="font-size:16px;color:#262626;line-height:1.5">A senha da sua conta no Tier Agent foi alterada em <b>{hora}</b> (horário de Brasília).</div>
<div style="margin-top:12px;font-size:14px;color:#4a5568;line-height:1.6">Se não foi você, use <b>«Esqueceu a senha?»</b> na tela de login para criar outra e avise o responsável pela conta.</div>""",
    )
    return assunto, html, texto
