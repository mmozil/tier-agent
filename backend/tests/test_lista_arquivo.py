"""Lista do disparo por arquivo (14/11/2026): CSV do Excel BR, .xlsx, .xls e o modelo para baixar.

O texto que sai daqui vai para a MESMA leitura da lista colada (`disparo_lote.ler_lista`), então
o teste confere o fim da linha: quantos contatos, com que nome e que número.
"""

import io
from pathlib import Path

import pytest

from services import disparo_lote
from services.lista_arquivo import (
    ArquivoInvalido,
    LIMITE_BYTES,
    ler_arquivo,
    modelo_csv,
    modelo_xlsx,
    para_texto,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _contatos(nome_arquivo: str, dados: bytes):
    out = para_texto(ler_arquivo(nome_arquivo, dados))
    return out, [(c.nome, c.numero) for c in disparo_lote.ler_lista(out["texto"]).contatos]


def test_csv_do_excel_brasileiro_ponto_e_virgula_latin1_com_cabecalho():
    # Excel BR: «;» e cp1252; a coluna Cidade vem ANTES do nome e não pode virar o nome.
    csv = "Cidade;Nome do responsável;Celular (com DDD)\r\nDiadema;Carla Mendes;11 98765-4321\r\nSão Bernardo;João Araújo;(11) 91234-5678\r\n"
    out, contatos = _contatos("lista.csv", csv.encode("cp1252"))
    assert out["colunas"] == {"nome": "Nome do responsável", "telefone": "Celular (com DDD)"}
    assert contatos == [("Carla Mendes", "5511987654321"), ("João Araújo", "5511912345678")]


def test_csv_com_virgula_sem_cabecalho():
    out, contatos = _contatos("x.csv", "Maria Silva,11 98765-4321\nAna Souza,21 99999-8888\n".encode())
    assert out["colunas"] == {"nome": None, "telefone": None}
    assert [n for n, _ in contatos] == ["Maria Silva", "Ana Souza"]


def test_xlsx_com_telefone_guardado_como_numero():
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["E-mail", "Responsável", "WhatsApp"])
    ws.append(["a@b.com", "Paula Dias", 5511987654321])  # inteiro
    ws.append(["c@d.com", "Rui Costa", 11912345678.0])  # float do Excel
    ws.append([None, None, None])  # linha vazia no meio
    buf = io.BytesIO()
    wb.save(buf)
    out, contatos = _contatos("planilha.xlsx", buf.getvalue())
    assert out["linhas"] == 2
    assert contatos == [("Paula Dias", "5511987654321"), ("Rui Costa", "5511912345678")]


def test_xls_antigo_de_verdade():
    pytest.importorskip("xlrd")
    dados = (FIXTURES / "lista-disparo-exemplo.xls").read_bytes()
    out, contatos = _contatos("lista.xls", dados)
    assert out["colunas"]["telefone"] == "Celular"
    assert contatos == [
        ("Carla Mendes", "5511987654321"),
        ("Bruno Lima", "5511912345678"),
        ("Débora Reis", "5511955554444"),
    ]


def test_modelos_para_baixar_voltam_como_lista_valida():
    for nome, dados in (("modelo.xlsx", modelo_xlsx()), ("modelo.csv", modelo_csv())):
        out, contatos = _contatos(nome, dados)
        assert [n for n, _ in contatos] == ["Maria Silva", "João Pereira", "Ana Souza"], nome
        assert out["colunas"] == {"nome": "nome", "telefone": "telefone"}, nome


def test_modelo_csv_abre_certo_no_excel_br():
    dados = modelo_csv()
    assert dados.startswith(b"\xef\xbb\xbf")  # BOM: o Excel lê UTF-8 sem estragar acento
    assert b"nome;telefone" in dados


def test_arquivo_vazio_grande_ou_disfarcado_e_recusado():
    with pytest.raises(ArquivoInvalido):
        ler_arquivo("x.csv", b"")
    with pytest.raises(ArquivoInvalido):
        ler_arquivo("x.csv", b"a" * (LIMITE_BYTES + 1))
    with pytest.raises(ArquivoInvalido):
        ler_arquivo("planilha.xlsx", b"nome;telefone\nMaria;11987654321\n")
