"""Editar mensagem do WhatsApp (21/10/2026).

Dois lados: (1) o painel edita a resposta que a pessoa mandou — só a dela, de texto,
com a chave do WhatsApp e dentro dos 15 min; (2) a família (ou o celular do número)
edita no WhatsApp e o balão troca de texto, em vez de a edição chegar como
«mensagem vazia» e sumir.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace

from routes.conversations import motivo_para_nao_editar
from routes.webhooks import _edicao_do_protocolo, _texto_editado

AGORA = datetime(2026, 10, 21, 21, 0, 0)


def _msg(**kw):
    base = dict(
        role="agent",
        wa_message_id="3EB0ABC",
        wa_from_me=True,
        member_id=7,
        attachments_json=None,
        created_at=AGORA - timedelta(minutes=2),
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ── quem pode editar ────────────────────────────────────────────────────────


def test_a_propria_resposta_recente_pode():
    assert motivo_para_nao_editar(_msg(), 7, AGORA) is None


def test_resposta_de_outra_pessoa_nao():
    assert "quem enviou" in motivo_para_nao_editar(_msg(member_id=8), 7, AGORA)


def test_quem_nao_tem_membro_nao_edita_nada():
    # sem identidade no Agent, a régua não sabe de quem é — não edita
    assert motivo_para_nao_editar(_msg(member_id=None), None, AGORA)


def test_mensagem_da_familia_e_da_ia_nao():
    assert motivo_para_nao_editar(_msg(role="user", wa_from_me=False), 7, AGORA)
    assert motivo_para_nao_editar(_msg(role="assistant"), 7, AGORA)


def test_sem_chave_do_whatsapp_nao():
    # as anteriores a 21/10 não guardaram a chave
    assert motivo_para_nao_editar(_msg(wa_message_id=None), 7, AGORA)


def test_anexo_nao():
    assert "texto" in motivo_para_nao_editar(_msg(attachments_json=[{"kind": "image"}]), 7, AGORA)


def test_passou_do_prazo_nao():
    assert "15 minutos" in motivo_para_nao_editar(_msg(created_at=AGORA - timedelta(minutes=15)), 7, AGORA)
    assert motivo_para_nao_editar(_msg(created_at=AGORA - timedelta(minutes=14)), 7, AGORA) is None


# ── edição que chega do WhatsApp ────────────────────────────────────────────


def test_protocolo_de_edicao_com_texto_simples():
    msg = {"protocolMessage": {"key": {"id": "3EB0X"}, "type": 14, "editedMessage": {"conversation": "novo"}}}
    assert _edicao_do_protocolo(msg) == ("3EB0X", "novo")


def test_protocolo_de_edicao_com_nome_do_tipo_e_texto_estendido():
    msg = {
        "protocolMessage": {
            "key": {"id": "3EB0Y"},
            "type": "MESSAGE_EDIT",
            "editedMessage": {"extendedTextMessage": {"text": "novo com link"}},
        }
    }
    assert _edicao_do_protocolo(msg) == ("3EB0Y", "novo com link")


def test_mensagem_apagada_nao_e_edicao():
    # REVOKE (tipo 0) também é protocolMessage — não pode virar texto vazio no balão
    assert _edicao_do_protocolo({"protocolMessage": {"key": {"id": "3EB0Z"}, "type": 0}}) is None


def test_mensagem_comum_nao_e_edicao():
    assert _edicao_do_protocolo({"conversation": "oi"}) is None


def test_texto_do_messages_update_nos_dois_formatos():
    # formato embrulhado (editedMessage.message.protocolMessage.editedMessage)
    a = {"editedMessage": {"message": {"protocolMessage": {"type": 14, "editedMessage": {"conversation": "um"}}}}}
    # formato direto (editedMessage.message.conversation)
    b = {"editedMessage": {"message": {"conversation": "dois"}}}
    assert _texto_editado(a) == "um"
    assert _texto_editado(b) == "dois"


def test_atualizacao_de_status_nao_e_edicao():
    assert _texto_editado(None) is None
    assert _texto_editado({"imageMessage": {"caption": "legenda"}}) is None
