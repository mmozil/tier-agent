"""Ninguém vê a conversa do outro — teste de PONTA A PONTA (31/10/2026).

Incidente da M7 (30/10/2026): consultores viam o WhatsApp uns dos outros. Os testes de
antes conferiam a REGRA (função pura) e se a trava estava ESCRITA na rota. Este entra
pelo HTTP como cada pessoa, num Postgres de verdade, e varre TODAS as rotas do app
procurando, na resposta, qualquer dado de cliente de outra pessoa. Rota nova entra
sozinha na varredura — não depende de alguém lembrar de testá-la.

Precisa de um Postgres VAZIO (o teste apaga tudo):
    TA_TESTE_PG_URL=postgresql+asyncpg://usuario:senha@host:porta/banco
Sem a variável, pula. Rode este arquivo sozinho (`pytest tests/test_vazamento_entre_consultores.py`):
as settings e o engine são criados no import, e outro teste antes dele já os teria criado
apontando para outro banco.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

PG = os.getenv("TA_TESTE_PG_URL", "")
if not PG:
    pytest.skip("defina TA_TESTE_PG_URL (Postgres vazio) para rodar a varredura", allow_module_level=True)
if "core.db" in sys.modules:
    pytest.skip("rode este arquivo sozinho: o engine já foi criado por outro teste", allow_module_level=True)

from cryptography.fernet import Fernet  # noqa: E402

os.environ["DATABASE_URL"] = PG
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ["FERNET_KEY"] = Fernet.generate_key().decode()
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"  # sem Redis: recusa na hora
os.environ["TIER_WHATSAPP_ENGINE_URL"] = "http://127.0.0.1:9"  # nada sai para a rede
os.environ["TIER_ERP_API_URL"] = "http://127.0.0.1:9"
os.environ["TIER_PAY_API_URL"] = "http://127.0.0.1:9"
os.environ["TIER_ERP_INTEGRATION_SECRET"] = "segredo-da-integracao-so-de-teste"
os.environ["ENVIRONMENT"] = "test"

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

import main  # noqa: E402
from core.auth import create_token  # noqa: E402
from core.db import Base, SessionLocal, engine  # noqa: E402
from core.encryption import encrypt  # noqa: E402
from models import (  # noqa: E402
    TaAgent,
    TaConnector,
    TaConversation,
    TaMacro,
    TaMember,
    TaMessageLog,
    TaNotification,
    TaPlaybook,
    TaPlaybookExecution,
    TaPlaybookStepLog,
    TaTenant,
)

SEGREDO = "segredo-da-integracao-so-de-teste"

# Cada «dono» de conversa tem marcas que só existem nos dados DELE. Se a marca aparece na
# resposta de outra pessoa, vazou — não importa por qual rota, campo ou formato.
MARCAS = {
    "A": ["CLIENTE-DO-A", "TEXTO-DO-A", "5511988880001"],
    "B": ["CLIENTE-DO-B", "TEXTO-DO-B", "5511988880002"],
    "C": ["CLIENTE-DA-CENTRAL", "TEXTO-DA-CENTRAL", "5511988880003"],  # número sem dono
    "T2": ["CLIENTE-DE-OUTRA-EMPRESA", "TEXTO-DE-OUTRA-EMPRESA", "5511988880009"],
}
# Quem pode ver o quê. A = consultor A; B = consultor B; G = administrador; D = dono.
PODE_VER = {"A": {"A"}, "B": {"B"}, "G": {"A", "B", "C"}, "D": {"A", "B", "C"}}

R: dict = {}  # ids criados no seed


# ─────────────────────────────── banco ────────────────────────────────


async def _preparar_banco() -> None:
    async with engine.begin() as con:
        await con.run_sync(Base.metadata.create_all)
    for nome in [n for n in dir(main) if n.startswith("_ensure_")]:
        await getattr(main, nome)()  # tabelas e colunas criadas em runtime (ta_connector_membro…)


async def _semear() -> None:
    async with engine.begin() as con:
        tabelas = (await con.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))).scalars().all()
        if tabelas:
            await con.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tabelas) + " RESTART IDENTITY CASCADE"))
    async with SessionLocal() as db:
        t1 = TaTenant(nome="Empresa Um", email="dono@um.teste", sku="pro", status="active")
        t2 = TaTenant(nome="Empresa Dois", email="dono@dois.teste", sku="pro", status="active")
        db.add_all([t1, t2])
        await db.flush()
        a = TaMember(tenant_id=t1.id, nome="Consultor A", email="a@um.teste", role="atendente", status="active")
        b = TaMember(tenant_id=t1.id, nome="Consultor B", email="b@um.teste", role="atendente", status="active")
        g = TaMember(tenant_id=t1.id, nome="Gestora G", email="g@um.teste", role="admin", status="active")
        x = TaMember(tenant_id=t2.id, nome="Consultor da outra empresa", email="x@dois.teste", role="atendente", status="active")
        db.add_all([a, b, g, x])
        await db.flush()
        ag1 = TaAgent(tenant_id=t1.id, nome="Agente Um", active=True)
        ag2 = TaAgent(tenant_id=t2.id, nome="Agente Dois", active=True)
        db.add_all([ag1, ag2])
        await db.flush()

        def _con(agent, membro, inst):
            cfg = encrypt(json.dumps({"instance_id": inst, "api_key": f"k-{inst}", "label": inst, "phone": "5511900000000"}))
            return TaConnector(agent_id=agent.id, kind="whatsapp", config_json_enc=cfg, enabled=True, modo="registro", member_id=membro)

        ca, cb, cc, ct2 = _con(ag1, a.id, "inst-a"), _con(ag1, b.id, "inst-b"), _con(ag1, None, "inst-c"), _con(ag2, None, "inst-t2")
        db.add_all([ca, cb, cc, ct2])
        await db.flush()

        convs, msgs, avisos = {}, {}, {}
        for dono, agente, conector, membro in (("A", ag1, ca, a.id), ("B", ag1, cb, b.id), ("C", ag1, cc, None), ("T2", ag2, ct2, None)):
            nome, texto, fone = MARCAS[dono]
            conv = TaConversation(
                agent_id=agente.id, connector_kind="whatsapp", external_id=fone, contact_name=nome,
                status="handed_off", msg_count=1, connector_id=conector.id, assigned_member_id=None,
                tags=[], priority="none", csat_state="none",
            )
            db.add(conv)
            await db.flush()
            m = TaMessageLog(conversation_id=conv.id, role="user", content=texto, member_id=membro)
            db.add(m)
            n = TaNotification(
                tenant_id=agente.tenant_id, agent_id=agente.id, conversation_id=conv.id, category="handoff",
                title=f"{nome} quer falar com humano", body=texto, payload_json={"telefone": fone}, status="unread",
            )
            db.add(n)
            await db.flush()
            convs[dono], msgs[dono], avisos[dono] = conv, m, n

        pb = TaPlaybook(agent_id=ag1.id, nome="Boas-vindas", canvas_json={}, status="active")
        db.add(pb)
        await db.flush()
        ex = TaPlaybookExecution(playbook_id=pb.id, agent_id=ag1.id, conversation_id=convs["B"].id, status="done",
                                 vars_json={"nome": MARCAS["B"][0], "telefone": MARCAS["B"][2]})
        db.add(ex)
        await db.flush()
        db.add(TaPlaybookStepLog(execution_id=ex.id, node_id="n1", node_type="message", status="ok"))
        mac = TaMacro(tenant_id=t1.id, name="Saudação", actions=[])
        if mac is not None:
            db.add(mac)
        await db.commit()

        R.clear()
        R.update(
            t1=t1.id, t2=t2.id, a=a.id, b=b.id, g=g.id, x=x.id, ag1=ag1.id, ag2=ag2.id,
            con={"A": ca.id, "B": cb.id, "C": cc.id, "T2": ct2.id},
            conv={k: v.id for k, v in convs.items()},
            msg={k: v.id for k, v in msgs.items()},
            aviso={k: v.id for k, v in avisos.items()},
            playbook=pb.id, execucao=ex.id, macro=getattr(mac, "id", 1),
        )


def _token(quem: str) -> str:
    if quem == "D":
        return create_token(str(R["t1"]), {"email": "dono@um.teste", "tenant_id": R["t1"], "is_admin": False, "role": "owner"})
    mid = R[quem.lower()]
    # o papel NO TOKEN é de propósito o mais alto: o servidor tem de ler o do banco
    return create_token(str(R["t1"]), {"email": f"{quem.lower()}@um.teste", "tenant_id": R["t1"], "is_admin": False,
                                       "member_id": mid, "member_name": quem, "role": "admin"})


# ─────────────────────────────── varredura ────────────────────────────────

# Escritas que levam o id de uma conversa SEM ler a conversa — conferido no código, um a um.
# Cada linha precisa do motivo; sem motivo, não entra.
NAO_LEEM_A_CONVERSA = {
    # o texto vem do corpo (o atendente escreve); o id fica só como rótulo de origem
    ("POST", "/api/v1/knowledge/from-feedback"),
}

ROTAS_DE_FORA = ("/api/v1/webhooks", "/api/v1/public", "/api/v1/mcp", "/api/v1/internal", "/api/v1/health", "/api/v1/auth")


def _valor_para(nome: str, alvo: str, tipo: str | None = None):
    """Valor de um parâmetro apontando para os dados do ALVO (o que não devia ser visto)."""
    n = nome.lower()
    if n in ("conversation_id", "conversa_id", "id_conversa"):
        return R["conv"][alvo]
    if n == "message_id":
        return R["msg"][alvo]
    if n == "notification_id":
        return R["aviso"][alvo]
    if n == "connector_id":
        return R["con"][alvo]
    if n == "agent_id":
        return R["ag2"] if alvo == "T2" else R["ag1"]
    if n == "agent_tenant_id":
        return R["t2"] if alvo == "T2" else R["t1"]
    if n in ("member_id", "assigned_member_id"):
        return {"B": R["b"], "T2": R["x"]}.get(alvo, R["a"])
    if n == "playbook_id":
        return R["playbook"]
    if n == "execution_id":
        return R["execucao"]
    if n == "macro_id":
        return R["macro"]
    if n == "modo":
        return "agente"  # no modo registro o agent_id do corpo é ignorado (usa o do próprio tenant)
    if n in ("telefone", "phone", "numero", "external_id", "q", "busca", "search", "termo"):
        return MARCAS[alvo][2]
    if tipo == "integer":
        return 1
    if tipo == "boolean":
        return False
    return "teste"


def _exemplo(schema: dict, comps: dict, alvo: str, nome: str = ""):
    if "$ref" in schema:
        return _exemplo(comps[schema["$ref"].split("/")[-1]], comps, alvo, nome)
    for k in ("anyOf", "oneOf", "allOf"):
        if k in schema:
            opcoes = [s for s in schema[k] if s.get("type") != "null"] or schema[k]
            return _exemplo(opcoes[0], comps, alvo, nome)
    tipo = schema.get("type")
    if tipo == "object" or "properties" in schema:
        return {p: _exemplo(s, comps, alvo, p) for p, s in (schema.get("properties") or {}).items()}
    if tipo == "array":
        return [_exemplo(schema.get("items") or {"type": "string"}, comps, alvo, nome[:-1])] if nome.endswith("_ids") else []
    if "enum" in schema:
        return schema["enum"][0]
    if nome.endswith("_ids"):
        return [_valor_para(nome[:-1], alvo, "integer")]
    return _valor_para(nome, alvo, tipo)


def _rotas():
    spec = main.app.openapi()
    comps = spec.get("components", {}).get("schemas", {})
    for caminho, metodos in spec["paths"].items():
        if caminho.startswith(ROTAS_DE_FORA):
            continue
        for metodo, op in metodos.items():
            yield caminho, metodo.upper(), op, comps


# Parâmetros que apontam para o DADO de alguém. Escrita sem nenhum deles é configuração
# (outra trava, `require_manager`), não privacidade de conversa — fica fora da varredura.
APONTA = {"conversation_id", "conversa_id", "id_conversa", "message_id", "notification_id", "connector_id",
          "agent_tenant_id", "telefone", "phone", "external_id", "execution_id", "member_id", "assigned_member_id",
          "conversation_ids", "connector_ids"}


def _aponta(nome: str, alvo: str) -> bool:
    return nome.lower() in APONTA or (alvo == "T2" and nome.lower() in ("agent_id", "agent_ids"))


def _chaves(obj) -> set:
    if isinstance(obj, dict):
        return set(obj) | {c for v in obj.values() for c in _chaves(v)}
    if isinstance(obj, list):
        return {c for v in obj for c in _chaves(v)}
    return set()


def _montar(caminho: str, op: dict, comps: dict, alvo: str):
    url = caminho
    params = {}
    aponta = False
    for p in op.get("parameters", []):
        nome, onde, tipo = p["name"], p["in"], (p.get("schema") or {}).get("type")
        if onde == "path":
            url = url.replace("{" + nome + "}", str(_valor_para(nome, alvo, tipo)))
            aponta = aponta or _aponta(nome, alvo)
        elif onde == "query" and (p.get("required") or nome in ("agent_tenant_id", "telefone", "q", "busca", "search")):
            params[nome] = _valor_para(nome, alvo, tipo)
    kw: dict = {"params": params}
    corpo = (op.get("requestBody") or {}).get("content") or {}
    if "application/json" in corpo:
        kw["json"] = _exemplo(corpo["application/json"]["schema"], comps, alvo)
    elif "multipart/form-data" in corpo:
        campos = _exemplo(corpo["multipart/form-data"]["schema"], comps, alvo)
        arquivos = {k: ("a.txt", b"oi", "text/plain") for k, v in (campos or {}).items() if v == "teste" and "file" in k.lower() or k in ("arquivo", "file")}
        kw["data"] = {k: str(v) for k, v in (campos or {}).items() if k not in arquivos}
        kw["files"] = arquivos or None
    corpo_chaves = _chaves(kw.get("json")) | set(kw.get("data") or {})
    aponta = aponta or any(_aponta(c, alvo) for c in corpo_chaves | set(params))
    return url, kw, aponta


async def _chamar(cli: httpx.AsyncClient, metodo: str, url: str, token: str | None, kw: dict, headers: dict | None = None):
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    try:
        return await asyncio.wait_for(cli.request(metodo, url, headers=h, **{k: v for k, v in kw.items() if v is not None}), 8)
    except TimeoutError:
        return None


def _vazou(corpo: str, quem: str) -> list[str]:
    proibidos = [d for d in MARCAS if d not in PODE_VER[quem]]
    return [f"{d}:{m}" for d in proibidos for m in MARCAS[d] if m in corpo]


async def varrer(quem: str, alvos: list[str], escrever: bool) -> dict:
    """Chama cada rota como `quem`, com os ids apontando para os dados de cada alvo."""
    achados = {"vazou": [], "passou_escrita": [], "inconclusivo": [], "total": 0}
    transporte = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transporte, base_url="http://teste") as cli:
        for alvo in alvos:
            for caminho, metodo, op, comps in _rotas():
                if metodo != "GET" and not escrever:
                    continue
                url, kw, aponta = _montar(caminho, op, comps, alvo)
                if metodo != "GET" and (not aponta or (metodo, caminho) in NAO_LEEM_A_CONVERSA):
                    continue  # escrita que não aponta para dado de ninguém (config) — fora do escopo
                if escrever and metodo != "GET":
                    await _semear()  # cada escrita começa do banco limpo
                    url, kw, _ = _montar(caminho, op, comps, alvo)
                achados["total"] += 1
                r = await _chamar(cli, metodo, url, _token(quem), kw)
                if r is None:
                    achados["inconclusivo"].append(f"{metodo} {caminho} (alvo {alvo}): não respondeu em 8 s")
                    continue
                corpo = r.text
                if 200 <= r.status_code < 300:
                    v = _vazou(corpo, quem)
                    if v:
                        achados["vazou"].append(f"{metodo} {caminho} (alvo {alvo}) → {r.status_code} {v}")
                    elif metodo != "GET" and alvo not in PODE_VER[quem]:
                        achados["passou_escrita"].append(f"{metodo} {caminho} (alvo {alvo}) → {r.status_code} {corpo[:160]}")
                elif r.status_code >= 500 and metodo != "GET" and alvo not in PODE_VER[quem]:
                    # passou da trava e quebrou adiante = a trava não está na frente
                    achados["passou_escrita"].append(f"{metodo} {caminho} (alvo {alvo}) → {r.status_code} (passou da trava?)")
                elif r.status_code >= 500:
                    achados["inconclusivo"].append(f"{metodo} {caminho} (alvo {alvo}) → {r.status_code} {corpo[:160]}")
                elif r.status_code == 422:
                    achados["inconclusivo"].append(f"{metodo} {caminho} (alvo {alvo}) → 422 {corpo[:160]}")
    return achados


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module", autouse=True)
def _banco():
    asyncio.set_event_loop(asyncio.new_event_loop())
    _rodar(_preparar_banco())
    _rodar(_semear())
    yield


# ─────────────────────────────── testes ────────────────────────────────


def test_a_varredura_nao_e_vazia():
    """Prova de que o teste enxerga: a gestora vê A, B e a central; cada consultor vê o seu."""

    async def _ver(quem):
        transporte = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transporte, base_url="http://teste") as cli:
            r = await cli.get("/api/v1/conversations", headers={"Authorization": f"Bearer {_token(quem)}"})
            return r.status_code, r.text

    s, corpo = _rodar(_ver("G"))
    assert s == 200 and all(MARCAS[d][0] in corpo for d in ("A", "B", "C")), corpo[:300]
    s, corpo = _rodar(_ver("A"))
    assert s == 200 and MARCAS["A"][0] in corpo and MARCAS["B"][0] not in corpo, corpo[:300]


@pytest.mark.parametrize("quem,alvos", [("A", ["B", "C", "T2"]), ("B", ["A", "C", "T2"]), ("G", ["T2"]), ("D", ["T2"])])
def test_leitura_nenhuma_rota_mostra_dado_do_outro(quem, alvos):
    achados = _rodar(varrer(quem, alvos, escrever=False))
    print(f"\n[{quem}] {achados['total']} chamadas · inconclusivas: {len(achados['inconclusivo'])}")
    for x in achados["inconclusivo"]:
        print("   ?", x)
    assert not achados["vazou"], "\n".join(achados["vazou"])


@pytest.mark.parametrize("quem,alvos", [("A", ["B", "C"]), ("B", ["A"]), ("G", ["T2"])])
def test_escrita_nenhuma_rota_age_na_conversa_do_outro(quem, alvos):
    achados = _rodar(varrer(quem, alvos, escrever=True))
    _rodar(_semear())
    print(f"\n[{quem}] {achados['total']} chamadas · inconclusivas: {len(achados['inconclusivo'])}")
    for x in achados["inconclusivo"]:
        print("   ?", x)
    erros = achados["vazou"] + achados["passou_escrita"]
    assert not erros, "\n".join(erros)


def test_card_do_crm_respeita_a_regra():
    """A aba Conversas do card (o ERP pergunta com a pessoa que abriu)."""

    async def _card(pessoa_role, owner_id, alvo):
        transporte = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transporte, base_url="http://teste") as cli:
            params = {"agent_tenant_id": R["t1"], "pessoa_role": pessoa_role}
            if owner_id:
                params["pessoa_owner_id"] = owner_id
            r = await cli.get(f"/api/v1/integrations/tier/conversas/{R['conv'][alvo]}/mensagens", params=params,
                              headers={"X-Tier-Integration-Secret": SEGREDO})
            return r.status_code, r.text

    async def _ligar_erp():
        async with SessionLocal() as db:
            await db.execute(text("UPDATE ta_member SET erp_owner_id = 'pessoa-a' WHERE id = :i"), {"i": R["a"]})
            await db.commit()

    _rodar(_ligar_erp())
    s, corpo = _rodar(_card("atendente", "pessoa-a", "B"))
    assert not _vazou(corpo, "A"), corpo[:300]
    s, corpo = _rodar(_card("atendente", "pessoa-a", "A"))
    assert s == 200 and MARCAS["A"][1] in corpo, corpo[:300]
    s, corpo = _rodar(_card("atendente", "pessoa-que-nao-existe", "B"))  # sem identidade: nada
    assert MARCAS["B"][1] not in corpo, corpo[:300]
    # outra empresa pelo id: o tenant prova de quem é
    s, corpo = _rodar(_card("admin", None, "T2"))
    assert MARCAS["T2"][1] not in corpo, corpo[:300]


def test_papel_trocado_vale_na_hora_sem_novo_login():
    async def _lista():
        transporte = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transporte, base_url="http://teste") as cli:
            r = await cli.get("/api/v1/conversations", headers={"Authorization": f"Bearer {tok}"})
            return r.status_code, r.text

    async def _papel(role, status="active"):
        async with SessionLocal() as db:
            await db.execute(text("UPDATE ta_member SET role = :r, status = :s WHERE id = :i"), {"r": role, "s": status, "i": R["a"]})
            await db.commit()

    tok = _token("A")  # o MESMO token durante todo o teste
    _rodar(_papel("admin"))
    s, corpo = _rodar(_lista())
    assert MARCAS["B"][0] in corpo  # virou admin: vê
    _rodar(_papel("atendente"))
    s, corpo = _rodar(_lista())
    assert MARCAS["B"][0] not in corpo  # deixou de ser: para de ver na mesma hora
    _rodar(_papel("atendente", "disabled"))
    s, corpo = _rodar(_lista())
    assert s == 401  # desligado: a sessão morre
    _rodar(_papel("atendente"))


def test_numero_dividido_aparece_so_para_quem_divide():
    async def _dividir():
        async with SessionLocal() as db:
            await db.execute(text("INSERT INTO ta_connector_membro (connector_id, member_id) VALUES (:c, :m)"),
                             {"c": R["con"]["C"], "m": R["a"]})
            await db.commit()

    async def _lista(quem):
        transporte = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transporte, base_url="http://teste") as cli:
            r = await cli.get("/api/v1/conversations", headers={"Authorization": f"Bearer {_token(quem)}"})
            return r.text

    _rodar(_dividir())
    assert MARCAS["C"][0] in _rodar(_lista("A"))
    assert MARCAS["C"][0] not in _rodar(_lista("B"))
    _rodar(_semear())


if __name__ == "__main__":  # relatório completo, sem pytest
    sys.exit(pytest.main([__file__, "-q", "-s", "-p", "no:cacheprovider"]))
