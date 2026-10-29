"""O nome do contato entra na conversa quando o cliente responde (29/10/2026).

A conversa só ganhava nome ao NASCER. Quando a vendedora escreve primeiro pelo celular, ela nasce
sem nome (a mensagem é dela, não traz o nome do cliente) e a resposta do cliente — que traz o nome
do perfil — não preenchia depois. Medido na M7: 108 das 109 conversas sem nome eram assim; em todas
as contas, 404 de 575. Sem a IA, o Atendimento tem de ser o WhatsApp Web do vendedor.
"""

import asyncio
from types import SimpleNamespace

from services import agent_runtime


class _Resultado:
    def __init__(self, conv):
        self._conv = conv

    def scalars(self):
        return SimpleNamespace(first=lambda: self._conv)


class _Db:
    def __init__(self, conv):
        self.conv = conv
        self.commits = 0

    async def execute(self, _q):
        return _Resultado(self.conv)

    async def commit(self):
        self.commits += 1


def _conv(nome):
    return SimpleNamespace(
        id=686, contact_name=nome, last_message_at=None, msg_count=1, snoozed_until=None, connector_id=46
    )


def _chama(monkeypatch, conv, nome_que_chegou):
    async def _nada(*_a, **_k):
        return None

    monkeypatch.setattr(agent_runtime, "_atribuir_pelo_numero", _nada)
    db = _Db(conv)
    return asyncio.run(
        agent_runtime.ensure_conversation(
            db, agent_id=1, connector_kind="whatsapp", external_id="5511961250350@s.whatsapp.net",
            contact_name=nome_que_chegou, connector_id=46, por_numero=True,
        )
    )


def test_resposta_do_cliente_preenche_conversa_sem_nome(monkeypatch):
    assert _chama(monkeypatch, _conv(None), "Cecília").contact_name == "Cecília"
    assert _chama(monkeypatch, _conv("   "), "Cecília").contact_name == "Cecília"


def test_nome_ja_gravado_nao_e_sobrescrito(monkeypatch):
    assert _chama(monkeypatch, _conv("Cecília Cecchetti"), "Ceci 🌸").contact_name == "Cecília Cecchetti"


def test_mensagem_da_vendedora_nao_apaga_nem_inventa_nome(monkeypatch):
    # do celular da vendedora o nome chega vazio (role agent): não mexe
    assert _chama(monkeypatch, _conv(None), None).contact_name is None
    assert _chama(monkeypatch, _conv("Cecília"), None).contact_name == "Cecília"
