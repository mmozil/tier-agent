"""16/11/2026 — rajada de mensagens do cliente: só a última responde (services/rajada.py)."""

import asyncio

from services import rajada


class _Res:
    def __init__(self, v):
        self.v = v

    def scalar(self):
        return self.v


class _Db:
    """Banco de mentira: devolve a última mensagem do cliente que o teste mandar."""

    def __init__(self, ultima):
        self.ultima = ultima

    async def execute(self, *_a, **_k):
        return _Res(self.ultima)

    async def rollback(self):
        pass


def _rodar(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_ler_segundos():
    assert rajada.ler_segundos(None) == rajada.PADRAO_S
    assert rajada.ler_segundos("") == rajada.PADRAO_S
    assert rajada.ler_segundos("0") == 0.0          # desliga a espera
    assert rajada.ler_segundos("3,5") == 3.5
    assert rajada.ler_segundos(4) == 4.0
    assert rajada.ler_segundos("99") == rajada.MAX_S == 15.0  # teto
    assert rajada.ler_segundos("12") == 12.0  # CCDA, 25/11/2026
    assert rajada.ler_segundos("-1") == rajada.PADRAO_S
    assert rajada.ler_segundos("abc") == rajada.PADRAO_S
    assert rajada.ler_segundos(True) == rajada.PADRAO_S


def test_cede_quando_chegou_outra_mensagem(monkeypatch):
    dormiu = []

    async def _dormir(s):
        dormiu.append(s)

    async def _segundos(_agent_id):
        return 2.5

    monkeypatch.setattr(rajada, "_dormir", _dormir)
    monkeypatch.setattr(rajada, "segundos_do_agente", _segundos)
    # «Bom dia» (id 10) e «Reunião» (id 11) chegaram juntas: a 10 cede, a 11 responde
    assert _rodar(rajada.ceder_antes_do_modelo(_Db(11), 25, 1746, 10)) is True
    assert _rodar(rajada.ceder_antes_do_modelo(_Db(11), 25, 1746, 11)) is False
    assert dormiu == [2.5, 2.5]


def test_espera_zero_nao_dorme_nem_cede(monkeypatch):
    async def _segundos(_agent_id):
        return 0.0

    async def _nao_pode(_s):
        raise AssertionError("não deveria esperar")

    monkeypatch.setattr(rajada, "segundos_do_agente", _segundos)
    monkeypatch.setattr(rajada, "_dormir", _nao_pode)
    assert _rodar(rajada.ceder_antes_do_modelo(_Db(11), 25, 1746, 10)) is False


def test_descarta_resposta_velha_salvo_se_usou_ferramenta():
    # chegou outra durante a geração → descarta; mas se o modelo agiu (ferramenta), a resposta sai
    assert _rodar(rajada.descartar_depois_do_modelo(_Db(12), 1878, 10, usou_ferramenta=False)) is True
    assert _rodar(rajada.descartar_depois_do_modelo(_Db(12), 1878, 10, usou_ferramenta=True)) is False
    assert _rodar(rajada.descartar_depois_do_modelo(_Db(10), 1878, 10, usou_ferramenta=False)) is False


def test_sem_id_nunca_cede():
    assert _rodar(rajada.chegou_outra(_Db(99), 1, None)) is False
