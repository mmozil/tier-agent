"""Ligações pelo WhatsApp oficial (14/11/2026) — regras puras do services/ligacoes.py."""

from services import ligacoes


def test_encerrada_com_duracao():
    assert ligacoes.estado_final("em_curso", {"status": "COMPLETED", "duration": 192, "start_time": "1"}) == "encerrada"


def test_sem_duracao_e_perdida():
    # A família desistiu antes de alguém atender: COMPLETED sem início nem duração.
    assert ligacoes.estado_final("tocando", {"status": "COMPLETED"}) == "perdida"


def test_recusada_por_nos_continua_recusada():
    assert ligacoes.estado_final("recusada", {"status": "COMPLETED"}) == "recusada"


def test_falhou():
    assert ligacoes.estado_final("em_curso", {"status": "FAILED", "duration": 10}) == "falhou"


def test_status_de_ligacao_nao_vira_tique_de_mensagem():
    msg = {"id": "wamid.1", "status": "read"}
    lig = {"id": "wacid.1", "type": "call", "status": "RINGING"}
    de_msg, de_lig = ligacoes.separar_statuses([msg, lig])
    assert de_msg == [msg]
    assert de_lig == [lig]


def test_rotulos_da_conversa():
    assert (
        ligacoes._rotulo("encerrada", "entrada", 192, "Marcelo")
        == "📞 Ligação recebida · 3 min 12 s · atendida por Marcelo"
    )
    assert ligacoes._rotulo("encerrada", "entrada", 40, None) == "📞 Ligação recebida · 40 s"
    assert ligacoes._rotulo("perdida", "entrada", None, None) == "📞 Ligação perdida"
    assert ligacoes._rotulo("recusada", "entrada", None, None) == "📞 Ligação recusada"
    assert ligacoes._rotulo("falhou", "entrada", None, None) == "📞 Ligação não completada"


def test_erro_da_meta_legivel():
    call = {"errors": [{"code": 138021, "message": "Call failed", "error_data": {"details": "timeout"}}]}
    assert ligacoes._erro_de(call) == "138021 · Call failed · timeout"
    assert ligacoes._erro_de({}) is None


def test_envio_ao_crm_monta_o_pedido(monkeypatch):
    """A gravação vai para «Ligações QA» do ERP com o id estável (idempotência no ERP)."""
    import asyncio

    from services import erp_crm_client

    pedidos = []

    class _Resp:
        status_code = 200

        def json(self):
            return {"id": 7}

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            pedidos.append((url, json, headers))
            return _Resp()

    monkeypatch.setattr(
        erp_crm_client, "_base_e_headers", lambda: ("https://erp.x", {"X-Tier-Integration-Secret": "s"})
    )
    monkeypatch.setattr(erp_crm_client.httpx, "AsyncClient", _Cli)
    loop = asyncio.new_event_loop()
    try:
        r = loop.run_until_complete(
            erp_crm_client.enviar_ligacao_whatsapp(
                agent_tenant_id=3,
                external_id="wa-agent-2",
                audio_url="https://pub.r2.dev/ligacoes/3/abc.webm",
                direcao="in",
                numero="5511999990000",
                atendente_nome="Marcelo",
                duracao_seg=21,
            )
        )
    finally:
        loop.close()
    assert r == {"id": 7}
    url, corpo, cab = pedidos[0]
    assert url == "https://erp.x/api/tier-empresas/crm/ligacoes/agent-whatsapp"
    assert corpo["external_id"] == "wa-agent-2" and corpo["agent_tenant_id"] == 3 and corpo["duracao_seg"] == 21
    assert cab["X-Tier-Integration-Secret"] == "s"


def test_ligar_no_numero_pede_o_botao_visivel_e_traz_o_motivo_da_meta(monkeypatch):
    """Ligar = ENABLED + botão visível; desligar = DISABLED; recusa da Meta volta com o motivo dela."""
    import asyncio

    from services import ligacoes

    enviados = []

    class _Resp:
        def __init__(self, code, corpo):
            self.status_code = code
            self._c = corpo
            self.text = str(corpo)

        def json(self):
            return self._c

    respostas = [
        _Resp(200, {"success": True}),
        _Resp(200, {"success": True}),
        _Resp(400, {"error": {"code": 138018, "error_user_msg": "Configure webhooks"}}),
    ]

    class _Cli:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            enviados.append(json)
            return respostas.pop(0)

    monkeypatch.setattr(ligacoes.httpx, "AsyncClient", _Cli)
    loop = asyncio.new_event_loop()
    try:
        r1 = loop.run_until_complete(ligacoes.mudar_na_meta("1", "t", True))
        r2 = loop.run_until_complete(ligacoes.mudar_na_meta("1", "t", False))
        r3 = loop.run_until_complete(ligacoes.mudar_na_meta("1", "t", True))
    finally:
        loop.close()
    assert enviados[0] == {"calling": {"status": "ENABLED", "call_icon_visibility": "DEFAULT"}}
    assert enviados[1] == {"calling": {"status": "DISABLED"}}
    assert r1["ok"] and r2["ok"]
    assert not r3["ok"] and "138018" in r3["motivo"] and "Configure webhooks" in r3["motivo"]


def test_erro_da_meta_vira_motivo_em_portugues():
    from services.entrega_whatsapp import explicar_erro_meta

    assert "forma de pagamento" in explicar_erro_meta(
        "WhatsApp Cloud 400: (#131042) Business eligibility payment issue"
    )
    assert "(código 131042)" in explicar_erro_meta("(#131042) Business eligibility payment issue")
    assert "não existe" in explicar_erro_meta("Meta 132001: Template name does not exist in the translation")
    assert explicar_erro_meta("falha sem código") == "falha sem código"


def test_gravacao_da_meta_no_webhook():
    """`calls[].call_recording.audio` com `event = call_recording_available` → o áudio a baixar."""
    call = {
        "id": "wacid.X",
        "event": "call_recording_available",
        "call_recording": {"type": "audio", "audio": {"id": "1002", "mime_type": "audio/ogg; codecs=opus"}},
    }
    assert ligacoes.audio_da_gravacao(call)["id"] == "1002"
    assert ligacoes.audio_da_gravacao({**call, "event": "terminate"}) is None
    assert ligacoes.audio_da_gravacao({"event": "call_recording_available"}) is None
    assert ligacoes.GRAVACAO_META["status"] == "ENABLED"
    assert ligacoes.GRAVACAO_META["announcement_language"] == "pt"


def test_ligar_pelo_whatsapp_regras_puras():
    assert ligacoes.numero_br("(11) 99999-0000") == "5511999990000"
    assert ligacoes.numero_br("5511999990000") == "5511999990000"
    assert ligacoes.sem_permissao("WhatsApp Cloud 400: (#138006) No approved call permission")
    assert not ligacoes.sem_permissao("(#131047) Re-engagement message")
    assert "chamando" in ligacoes.ESTADOS_ATIVOS
    assert ligacoes._rotulo("chamando", "saida", None, None) == "📞 Chamando…"
    assert ligacoes._rotulo("encerrada", "saida", 75, "Marcelo").startswith("📞 Ligação feita · 1 min 15 s")


def test_status_de_ligacao_usa_um_parametro_por_papel():
    """asyncpg recusa o MESMO parâmetro com dois tipos (AmbiguousParameterError) — o «atendeu» nunca gravava."""
    import inspect

    fonte = inspect.getsource(ligacoes.registrar_status_de_chamada)
    assert "CASE WHEN :atendeu" in fonte and "CASE WHEN :e" not in fonte


def test_telefone_com_traco_longo_sai_com_hifen():
    """«(11) 4043–0461» (traço longo nas instruções, para o filtro de dados pessoais não trocar o número) sai
    «(11) 4043-0461» — a regra do travessão virava «4043, 0461» (CCDA, 15/11/2026)."""
    from services.agent_runtime import _sem_travessao

    assert _sem_travessao("secretaria: (11) 4043\u20130461. Se preferir") == "secretaria: (11) 4043-0461. Se preferir"
    assert _sem_travessao("das 8 \u2013 17h") == "das 8-17h"
    assert _sem_travessao("Visitas \u2014 de segunda a sexta") == "Visitas, de segunda a sexta"


def test_desligar_manda_ao_crm_na_hora(monkeypatch):
    """16/11/2026 (M7, ligação 16): o navegador sobe a gravação JUNTO com o «desligar». A tarefa da gravação
    rodava com a ligação ainda em curso e desistia — o CRM só via a ligação 4 min depois. O «desligar» agora
    agenda o envio, que segue na hora se a gravação já está guardada."""
    import asyncio
    from types import SimpleNamespace

    from fastapi import BackgroundTasks

    from routes import ligacoes as rota

    async def _da_conta(db, ligacao_id, tenant_id):
        return SimpleNamespace(id=ligacao_id, call_id="wacid.x", connector_id=57, estado="em_curso")

    async def _na_meta(db, connector_id, corpo):
        return {"success": True}

    class _Db:
        def __init__(self):
            self.sqls = []

        async def execute(self, sql, params=None):
            self.sqls.append(str(sql))

        async def commit(self):
            pass

    monkeypatch.setattr(rota, "_da_conta", _da_conta)
    monkeypatch.setattr(ligacoes, "acao_na_meta", _na_meta)
    tarefas = BackgroundTasks()
    db = _Db()
    loop = asyncio.new_event_loop()
    try:
        r = loop.run_until_complete(rota.encerrar(16, tarefas, SimpleNamespace(tenant_id=18), db))
    finally:
        loop.close()
    assert r == {"ok": True}
    assert any("estado = 'encerrada'" in s for s in db.sqls)
    agendadas = [(t.func, t.args) for t in tarefas.tasks]
    assert agendadas == [(ligacoes.mandar_para_o_crm, (16,))]


def test_envio_ao_crm_trava_a_linha():
    """Dois processos podem mandar a mesma ligação juntos: a leitura trava a linha (FOR UPDATE OF l, porque o
    LEFT JOIN no membro não aceita trava) para o segundo ver o `crm_ligacao_id` do primeiro e desistir."""
    import inspect

    fonte = inspect.getsource(ligacoes.mandar_para_o_crm)
    assert "FOR UPDATE OF l" in fonte
