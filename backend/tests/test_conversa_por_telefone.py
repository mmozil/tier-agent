"""O WhatsApp do contato no CRM abre a conversa aqui (15/10/2026, M7-257)."""

from routes.conversations import _variantes_do_numero


def test_com_e_sem_o_9_e_com_e_sem_o_55():
    assert _variantes_do_numero("5511940828393") == ["551140828393", "5511940828393"]
    assert _variantes_do_numero("551140828393") == ["551140828393", "5511940828393"]
    # Gravado no CRM sem o 55 («(11) 94082-8393»).
    assert _variantes_do_numero("11940828393") == ["11940828393", "551140828393", "5511940828393"]
