"""Pente fino do incidente da M7 (30/10/2026): toda porta que mostra conversa passa pela régua.

Guardas estruturais — o vazamento volta em silêncio quando alguém cria ou mexe numa rota
e esquece a trava. Cada caso aqui era uma porta aberta medida no código.
"""
import ast
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parents[1]


def _corpo(arquivo: str, funcao: str) -> str:
    arvore = ast.parse((RAIZ / arquivo).read_text(encoding="utf-8"))
    for no in ast.walk(arvore):
        if isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)) and no.name == funcao:
            return ast.unparse(no)
    raise AssertionError(f"{funcao} sumiu de {arquivo}")


def test_sino_filtra_pelo_que_a_pessoa_ve():
    for f in ("list_notifications", "notification_stats", "mark_all_read", "_aviso_que_ve"):
        assert "_so_o_que_ve(" in _corpo("routes/notifications.py", f), f
    assert "filtro_para(" in _corpo("routes/notifications.py", "_so_o_que_ve")
    for f in ("mark_read", "archive_notification"):
        assert "_aviso_que_ve(" in _corpo("routes/notifications.py", f), f


def test_telas_de_apoio_sao_de_gestor():
    for arquivo, funcao in (
        ("routes/notifications.py", "put_alert_config"),
        ("routes/playbooks.py", "list_executions"),
        ("routes/playbooks.py", "list_execution_steps"),
        ("routes/metrics.py", "top_conversations"),
        ("routes/agents.py", "list_memories"),
    ):
        assert "exigir_gestor(" in _corpo(arquivo, funcao), f"{arquivo}:{funcao}"


def test_precisa_de_voce_filtra():
    corpo = _corpo("routes/attention.py", "attention_queue")
    assert "filtro_para(" in corpo and "_so_o_que_ve(" in corpo


def test_reconectar_derruba_a_sessao_antiga_de_verdade():
    assert "logout_instance(" in _corpo("routes/connectors.py", "_encerrar_instancia")
    for f in ("connect", "provision_whatsapp"):
        assert "_encerrar_instancia(" in _corpo("routes/connectors.py", f), f
