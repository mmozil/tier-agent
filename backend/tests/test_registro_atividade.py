"""Registro de atividades: toda ação de todo usuário, com quem, o quê e de onde (11/11/2026).

Incidente do CCDA: o número de teste foi refeito por QR e removido às 11:20, e o sistema não
sabia QUEM. Estes testes provam o caminho inteiro do middleware (sem banco: o gravador é
trocado por uma lista), inclusive que a senha do login nunca entra no registro.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@localhost/teste")
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ.setdefault("FERNET_KEY", "chave-so-de-teste-com-mais-de-32-caracteres")

import pytest  # noqa: E402
from fastapi import FastAPI, HTTPException, Request, Response  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.auth import create_token  # noqa: E402
from services import registro_atividade as ra  # noqa: E402


# ── Nomes das ações ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "metodo,rota,esperado",
    [
        ("DELETE", "/connectors/51", "Removeu número"),
        ("POST", "/connectors/whatsapp/provision", "Conectou número por QR"),
        ("POST", "/connectors/51/connect", "Abriu o QR do número"),
        ("POST", "/connectors/whatsapp-cloud/onboard", "Conectou WhatsApp oficial"),
        ("POST", "/conversations/812/reply", "Respondeu na conversa"),
        ("POST", "/conversations/812/handoff", "Assumiu a conversa (pausou a IA)"),
        ("DELETE", "/conversations/812", "Apagou a conversa"),
        ("POST", "/auth/login", "Entrou no sistema"),
        ("POST", "/auth/logout", "Saiu do sistema"),
        ("DELETE", "/team/members/7", "Removeu pessoa da equipe"),
        ("PATCH", "/agents/26", "Alterou agente"),
        ("POST", "/macros/3/apply", "Aplicou macro"),
        ("PUT", "/macros/3", "Mudou macro"),
    ],
)
def test_nome_da_acao(metodo, rota, esperado):
    assert ra.rotulo(metodo, rota) == esperado


def test_rota_desconhecida_ganha_nome_generico_e_curto():
    assert ra.rotulo("DELETE", "/coisa-nova/9") == "Apagou coisa-nova"
    assert len(ra.rotulo("POST", "/" + "x" * 200)) <= 64


def test_alvo_da_rota():
    assert ra.recurso_e_id("/connectors/51") == ("número", 51)
    assert ra.recurso_e_id("/conversations/812/reply") == ("conversa", 812)
    assert ra.recurso_e_id("/team/members/7") == ("pessoa", 7)
    assert ra.recurso_e_id("/auth/login") == ("auth", None)


def test_token_invalido_nao_vira_pessoa():
    assert ra.identidade("nao-e-um-token") is None
    assert ra.identidade(None) is None


# ── Middleware de ponta a ponta ────────────────────────────────────────────────────────
@pytest.fixture
def app_e_eventos(monkeypatch):
    eventos: list[dict] = []
    monkeypatch.setattr(ra, "registrar", lambda ev: eventos.append(ev))
    app = FastAPI()
    app.add_middleware(ra.RegistroDeAtividade)

    @app.delete("/api/v1/connectors/{cid}", status_code=204)
    async def remover(cid: int, request: Request):
        request.state.atividade = {"alvo": "número +55 19 99701-2137 · agente Agent CCDA"}
        return Response(status_code=204)

    @app.post("/api/v1/conversations/{cid}/reply")
    async def responder(cid: int, corpo: dict):
        return {"ok": True, "eco": corpo.get("content")}

    @app.get("/api/v1/conversations")
    async def listar():
        return []

    @app.post("/api/v1/webhooks/whatsapp-engine")
    async def webhook():
        return {"ok": True}

    @app.post("/api/v1/auth/login")
    async def login(corpo: dict, response: Response):
        if corpo.get("password") != "certa":
            raise HTTPException(401, "Credenciais inválidas")
        tok = create_token("17", {"tenant_id": 17, "email": "augusto@ccda.com.br", "role": "owner"})
        response.set_cookie("ta_session", tok, httponly=True)
        return {"access_token": tok}

    return TestClient(app), eventos


def _token_membro():
    return create_token(
        "17",
        {
            "tenant_id": 17,
            "email": "nathalia@ccda.com.br",
            "member_id": 26,
            "member_name": "Nathalia Azambuja",
            "role": "atendente",
        },
    )


def test_remocao_grava_quem_e_o_numero(app_e_eventos):
    cli, ev = app_e_eventos
    r = cli.delete(
        "/api/v1/connectors/51",
        headers={
            "Authorization": f"Bearer {_token_membro()}",
            "CF-Connecting-IP": "177.10.20.30",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130",
        },
    )
    assert r.status_code == 204
    assert len(ev) == 1
    e = ev[0]
    assert e["tenant_id"] == 17
    assert e["quem"] == "Nathalia Azambuja"
    assert e["acao"] == "Removeu número"
    assert e["alvo"] == "número +55 19 99701-2137 · agente Agent CCDA"  # o enriquecimento da rota chegou
    assert e["detalhe"]["member_id"] == 26
    assert e["detalhe"]["ip"] == "177.10.20.30"
    assert e["detalhe"]["status"] == 204


def test_dono_pelo_cookie_e_corpo_da_rota_intacto(app_e_eventos):
    cli, ev = app_e_eventos
    tok = create_token("17", {"tenant_id": 17, "email": "augusto@ccda.com.br", "role": "owner"})
    cli.cookies.set("ta_session", tok)
    r = cli.post("/api/v1/conversations/812/reply", json={"content": "Olá, família"})
    assert r.json() == {"ok": True, "eco": "Olá, família"}
    assert ev[0]["quem"] == "Dono da conta (augusto@ccda.com.br)"
    assert ev[0]["alvo"] == "conversa #812"
    # O conteúdo da mensagem NÃO vai para o registro.
    assert "Olá, família" not in repr(ev[0])


def test_leitura_webhook_e_pedido_sem_login_nao_gravam(app_e_eventos):
    cli, ev = app_e_eventos
    cli.get("/api/v1/conversations", headers={"Authorization": f"Bearer {_token_membro()}"})
    cli.post("/api/v1/webhooks/whatsapp-engine", json={})
    cli.post("/api/v1/conversations/1/reply", json={"content": "x"})  # sem token
    assert ev == []


def test_login_errado_grava_o_email_e_nunca_a_senha(app_e_eventos):
    cli, ev = app_e_eventos
    r = cli.post("/api/v1/auth/login", json={"email": "Augusto@CCDA.com.br", "password": "senha-secreta-123"})
    assert r.status_code == 401
    assert ev[0]["acao"] == "Tentou entrar (recusado)"
    assert ev[0]["quem"] == "augusto@ccda.com.br"
    assert ev[0]["email_tentado"] == "augusto@ccda.com.br"  # o gravador acha a empresa por ele
    assert "senha-secreta-123" not in repr(ev[0])


def test_login_certo_tira_a_pessoa_do_cookie_devolvido(app_e_eventos):
    cli, ev = app_e_eventos
    r = cli.post("/api/v1/auth/login", json={"email": "augusto@ccda.com.br", "password": "certa"})
    assert r.status_code == 200
    assert ev[0]["acao"] == "Entrou no sistema"
    assert ev[0]["tenant_id"] == 17
    assert ev[0]["quem"] == "Dono da conta (augusto@ccda.com.br)"
    assert ev[0]["email_tentado"] is None


def test_hora_e_da_acao(monkeypatch):
    # O `registrar` de verdade carimba a hora no momento da ação.
    ra._fila = None
    ra.registrar({"acao": "x"})
    ev = ra._fila.get_nowait()
    assert ev["quando"] is not None and ev["quando"].tzinfo is None
    ra._fila = None
