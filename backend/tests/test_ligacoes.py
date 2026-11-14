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
