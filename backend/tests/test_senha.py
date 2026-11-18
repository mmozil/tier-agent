"""Trocar / redefinir a senha com código no e-mail (18/11/2026).

Cobre: as regras (tamanho, código de 6 dígitos, máscara), o código (vale uma vez, 15 min, 5 tentativas,
espera de 60 s, só HMAC no Redis), a troca em Meu perfil (senha atual, igual à atual, sem senha = define),
o «Esqueceu a senha?» (mesma resposta com ou sem conta), o e-mail que não sai (código apagado, 502) e a
conta certa (dono antes do membro, membro inativo fora). Redis e Resend de mentira.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()` (ver test_disparo_lote).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@localhost/teste")
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ.setdefault("FERNET_KEY", "chave-so-de-teste-com-mais-de-32-caracteres")

import asyncio  # noqa: E402
import json  # noqa: E402

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from core.auth import CurrentUser  # noqa: E402
from core.db import Base  # noqa: E402
from models import TaMember, TaTenant  # noqa: E402
from routes import auth as rota  # noqa: E402
from services import email_transacional, senha  # noqa: E402


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _Redis:
    """Redis de mentira: set (nx/ex), get, ttl, delete, aclose — o que services/senha.py usa."""

    def __init__(self):
        self.d: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def set(self, k, v, ex=None, nx=False):
        if nx and k in self.d:
            return None
        self.d[k] = v
        self.ttls[k] = ex or -1
        return True

    async def get(self, k):
        return self.d.get(k)

    async def ttl(self, k):
        return self.ttls.get(k, -2)

    async def delete(self, *ks):
        for k in ks:
            self.d.pop(k, None)
            self.ttls.pop(k, None)

    async def aclose(self):
        return None

    def expirar_espera(self):
        for k in [k for k in self.d if ":espera:" in k]:
            self.d.pop(k)


class _Db:
    def __init__(self, s):
        self.s = s

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)

    async def commit(self):
        self.s.commit()

    async def get(self, modelo, id_, **kw):
        return self.s.get(modelo, id_, **kw)


@pytest.fixture
def amb(monkeypatch):
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[TaTenant.__table__, TaMember.__table__])
    s = Session(motor, expire_on_commit=False)
    s.add(TaTenant(id=17, nome="CCDA", email="augusto@ccda.com.br", password_hash=rota.pwd_ctx.hash("senha-antiga-1")))
    s.add(TaTenant(id=3, nome="Out", email="dono@out.com"))  # sem senha (entrou pelo Google)
    s.flush()
    s.add_all(
        [
            # o mesmo e-mail do dono: o login é do DONO (a tela de login olha o dono primeiro)
            TaMember(id=14, tenant_id=17, nome="Augusto", email="augusto@ccda.com.br", role="admin", status="active"),
            TaMember(
                id=7,
                tenant_id=17,
                nome="Débora",
                email="debora@ccda.com.br",
                role="atendente",
                status="active",
                password_hash=rota.pwd_ctx.hash("debora-123"),
            ),
            TaMember(
                id=8,
                tenant_id=17,
                nome="Saiu",
                email="saiu@ccda.com.br",
                role="atendente",
                status="disabled",
                password_hash=rota.pwd_ctx.hash("saiu-1234"),
            ),
        ]
    )
    s.commit()
    r = _Redis()

    async def _r():
        return r

    monkeypatch.setattr(senha, "_redis", _r)
    enviados: list[tuple[str, str, str]] = []
    falhar = {"sim": False}

    async def _enviar(para, assunto, html, texto):
        if falhar["sim"]:
            raise email_transacional.ErroDeEmail("recusou (500)")
        enviados.append((para, assunto, texto))
        return "id"

    monkeypatch.setattr(email_transacional, "enviar", _enviar)
    monkeypatch.setattr(email_transacional, "configurado", lambda: True)
    yield type("Amb", (), {"db": _Db(s), "s": s, "r": r, "enviados": enviados, "falhar": falhar})
    s.close()
    motor.dispose()


def _codigo(texto: str) -> str:
    import re

    return re.search(r"\b(\d{6})\b", texto).group(1)


def _dono():
    return CurrentUser(17, "augusto@ccda.com.br", tenant_id=17, role="owner")


# ─── 1. regras ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("s", "ok"), [("1234567", False), ("12345678", True), ("        ", False), ("x" * 129, False)])
def test_tamanho_da_senha(s, ok):
    if ok:
        assert senha.validar_nova(s) == s
    else:
        with pytest.raises(senha.ErroDeSenha):
            senha.validar_nova(s)


def test_codigo_mascara_e_hash():
    c = senha.gerar_codigo()
    assert len(c) == 6 and c.isdigit()
    assert senha.mascarar("augusto@ccda.com.br") == "aug…@ccda.com.br"
    assert senha._hash("123456", "A@b.com") == senha._hash("123456", "a@b.com")  # e-mail sem caixa
    assert senha._hash("123456", "a@b.com") != senha._hash("123457", "a@b.com")


# ─── 2. o código ──────────────────────────────────────────────────────────────


def test_codigo_vale_uma_vez_e_o_redis_so_ve_o_hash(amb):
    c = _rodar(senha.pedir("a@b.com", senha.ESQUECI))
    guardado = json.loads(amb.r.d["ta:senha:a@b.com"])
    assert c not in json.dumps(guardado) and guardado["cod"] == senha._hash(c, "a@b.com")
    assert amb.r.ttls["ta:senha:a@b.com"] == 15 * 60
    assert _rodar(senha.conferir("a@b.com", c, senha.ESQUECI))["motivo"] == "esqueci"
    with pytest.raises(senha.ErroDeSenha) as e:
        _rodar(senha.conferir("a@b.com", c, senha.ESQUECI))
    assert e.value.http == 410


def test_espera_de_60s_para_outro_codigo(amb):
    _rodar(senha.pedir("a@b.com", senha.ESQUECI))
    with pytest.raises(senha.ErroDeSenha) as e:
        _rodar(senha.pedir("a@b.com", senha.ESQUECI))
    assert e.value.http == 429 and "Aguarde" in str(e.value)


def test_cinco_erros_matam_o_codigo(amb):
    c = _rodar(senha.pedir("a@b.com", senha.ESQUECI))
    errado = "000000" if c != "000000" else "111111"
    for restam in (4, 3, 2, 1):
        with pytest.raises(senha.ErroDeSenha) as e:
            _rodar(senha.conferir("a@b.com", errado, senha.ESQUECI))
        assert f"Restam {restam}" in str(e.value)
    with pytest.raises(senha.ErroDeSenha) as e:
        _rodar(senha.conferir("a@b.com", errado, senha.ESQUECI))
    assert e.value.http == 429
    with pytest.raises(senha.ErroDeSenha) as e:
        _rodar(senha.conferir("a@b.com", c, senha.ESQUECI))  # nem o certo vale mais
    assert e.value.http == 410


def test_codigo_de_um_caminho_nao_serve_no_outro(amb):
    c = _rodar(senha.pedir("a@b.com", senha.TROCAR, "hash"))
    with pytest.raises(senha.ErroDeSenha) as e:
        _rodar(senha.conferir("a@b.com", c, senha.ESQUECI))
    assert e.value.http == 410


def test_codigo_com_espaco_ou_traco_vale(amb):
    c = _rodar(senha.pedir("a@b.com", senha.ESQUECI))
    assert _rodar(senha.conferir("a@b.com", f"{c[:3]} {c[3:]}", senha.ESQUECI))


# ─── 3. Meu perfil › Senha ────────────────────────────────────────────────────


def test_troca_no_perfil_com_codigo(amb):
    out = _rodar(
        rota.senha_pedir_codigo(
            rota.SenhaCodigoIn(senha_atual="senha-antiga-1", nova_senha="nova-senha-22"), amb.db, _dono()
        )
    )
    assert out == {"ok": True, "enviado_para": "aug…@ccda.com.br", "validade_min": 15}
    ((para, assunto, texto),) = amb.enviados
    assert para == "augusto@ccda.com.br" and "trocar a senha" in assunto
    t = amb.s.get(TaTenant, 17)
    assert rota.pwd_ctx.verify("senha-antiga-1", t.password_hash)  # nada muda antes do código
    assert _rodar(rota.senha_confirmar(rota.SenhaConfirmarIn(codigo=_codigo(texto)), amb.db, _dono())) == {"ok": True}
    t = amb.s.get(TaTenant, 17, populate_existing=True)
    assert rota.pwd_ctx.verify("nova-senha-22", t.password_hash)
    assert "foi alterada" in amb.enviados[-1][1]  # aviso depois da troca


@pytest.mark.parametrize(
    ("atual", "nova", "http"),
    [
        (None, "nova-senha-22", 422),
        ("errada-123", "nova-senha-22", 422),
        ("senha-antiga-1", "senha-antiga-1", 422),
        ("senha-antiga-1", "curta", 422),
    ],
)
def test_troca_no_perfil_recusa(amb, atual, nova, http):
    with pytest.raises(HTTPException) as e:
        _rodar(rota.senha_pedir_codigo(rota.SenhaCodigoIn(senha_atual=atual, nova_senha=nova), amb.db, _dono()))
    assert e.value.status_code == http
    assert amb.enviados == []


def test_membro_com_o_email_do_dono_troca_a_senha_do_login(amb):
    """O Augusto pelo CRM é o membro 14 — mas o login com o e-mail dele é o do DONO."""
    membro = CurrentUser(17, "augusto@ccda.com.br", tenant_id=17, member_id=14, role="admin")
    _rodar(
        rota.senha_pedir_codigo(
            rota.SenhaCodigoIn(senha_atual="senha-antiga-1", nova_senha="nova-senha-22"), amb.db, membro
        )
    )
    _rodar(rota.senha_confirmar(rota.SenhaConfirmarIn(codigo=_codigo(amb.enviados[0][2])), amb.db, membro))
    assert rota.pwd_ctx.verify("nova-senha-22", amb.s.get(TaTenant, 17, populate_existing=True).password_hash)
    assert amb.s.get(TaMember, 14, populate_existing=True).password_hash is None


def test_conta_sem_senha_define_so_com_o_codigo(amb):
    dono_google = CurrentUser(3, "dono@out.com", tenant_id=3, role="owner")
    _rodar(rota.senha_pedir_codigo(rota.SenhaCodigoIn(nova_senha="primeira-senha"), amb.db, dono_google))
    _rodar(rota.senha_confirmar(rota.SenhaConfirmarIn(codigo=_codigo(amb.enviados[0][2])), amb.db, dono_google))
    assert rota.pwd_ctx.verify("primeira-senha", amb.s.get(TaTenant, 3, populate_existing=True).password_hash)


def test_email_que_nao_sai_apaga_o_codigo_e_libera_outro(amb):
    amb.falhar["sim"] = True
    with pytest.raises(HTTPException) as e:
        _rodar(
            rota.senha_pedir_codigo(
                rota.SenhaCodigoIn(senha_atual="senha-antiga-1", nova_senha="nova-senha-22"), amb.db, _dono()
            )
        )
    assert e.value.status_code == 502
    assert amb.r.d == {}  # nem código nem espera: pode pedir de novo na hora
    amb.falhar["sim"] = False
    _rodar(
        rota.senha_pedir_codigo(
            rota.SenhaCodigoIn(senha_atual="senha-antiga-1", nova_senha="nova-senha-22"), amb.db, _dono()
        )
    )
    assert len(amb.enviados) == 1


def test_sem_chave_de_email_responde_503(amb, monkeypatch):
    monkeypatch.setattr(email_transacional, "configurado", lambda: False)
    with pytest.raises(HTTPException) as e:
        _rodar(rota.senha_esqueci(rota.EsqueciIn(email="augusto@ccda.com.br"), amb.db))
    assert e.value.status_code == 503


# ─── 4. «Esqueceu a senha?» ───────────────────────────────────────────────────


def test_esqueci_e_redefinir(amb):
    out = _rodar(rota.senha_esqueci(rota.EsqueciIn(email="debora@ccda.com.br"), amb.db))
    assert out["ok"]
    ((para, assunto, texto),) = amb.enviados
    assert para == "debora@ccda.com.br" and "nova senha" in assunto
    body = rota.RedefinirIn(email="debora@ccda.com.br", codigo=_codigo(texto), nova_senha="debora-nova-9")
    assert _rodar(rota.senha_redefinir(body, amb.db)) == {"ok": True}
    assert rota.pwd_ctx.verify("debora-nova-9", amb.s.get(TaMember, 7, populate_existing=True).password_hash)


@pytest.mark.parametrize("email", ["ninguem@x.com", "saiu@ccda.com.br"])
def test_esqueci_sem_conta_responde_igual_e_nao_manda_nada(amb, email):
    com = _rodar(rota.senha_esqueci(rota.EsqueciIn(email="debora@ccda.com.br"), amb.db))
    sem = _rodar(rota.senha_esqueci(rota.EsqueciIn(email=email), amb.db))
    assert com == sem
    assert [p for p, _, _ in amb.enviados] == ["debora@ccda.com.br"]
    with pytest.raises(HTTPException) as e:
        _rodar(rota.senha_redefinir(rota.RedefinirIn(email=email, codigo="123456", nova_senha="qualquer-123"), amb.db))
    assert e.value.status_code == 410


def test_redefinir_com_codigo_errado_nao_troca(amb):
    _rodar(rota.senha_esqueci(rota.EsqueciIn(email="debora@ccda.com.br"), amb.db))
    certo = _codigo(amb.enviados[0][2])
    errado = "000000" if certo != "000000" else "111111"
    with pytest.raises(HTTPException) as e:
        _rodar(
            rota.senha_redefinir(
                rota.RedefinirIn(email="debora@ccda.com.br", codigo=errado, nova_senha="debora-nova-9"), amb.db
            )
        )
    assert e.value.status_code == 422
    assert rota.pwd_ctx.verify("debora-123", amb.s.get(TaMember, 7, populate_existing=True).password_hash)


def test_me_diz_se_a_conta_tem_senha(amb):
    assert _rodar(rota._conta_do_login(amb.db, "augusto@ccda.com.br")).id == 17  # dono antes do membro
    assert _rodar(rota._conta_do_login(amb.db, "saiu@ccda.com.br")) is None  # membro desligado
    assert _rodar(rota._conta_do_login(amb.db, "debora@ccda.com.br")).id == 7
