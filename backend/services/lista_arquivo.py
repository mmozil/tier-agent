"""Lista de contatos do disparo a partir de ARQUIVO (14/11/2026).

Pedido do dono: «colocar campo para importar xls e csv … e um para baixar com um padrão». Até
aqui a lista só entrava colada na caixa de texto. Agora:

- `.csv`/`.txt` em qualquer separador (`;` `,` TAB `|`) e codificação (o Excel brasileiro salva
  CSV em `;` e Latin-1/cp1252), `.xlsx` (openpyxl) e `.xls` antigo (xlrd);
- a 1ª linha que é cabeçalho («nome», «telefone», «celular», «whatsapp»…) é usada para achar AS
  colunas de nome e telefone — numa planilha com cidade/e-mail/série, sem isso o «nome» podia sair
  da coluna errada — e não entra como contato;
- a saída é TEXTO, uma linha por contato («nome<TAB>telefone»), que vai para a mesma caixa e para
  a MESMA leitura do servidor (`disparo_lote.ler_lista`): uma regra só, colado ou importado.

O modelo para baixar tem as duas colunas, com exemplos, em `.xlsx` (telefone como TEXTO, senão o
Excel come o zero e vira notação científica) e em `.csv` com `;` e BOM (abre certo no Excel BR).
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata

from services.disparo_lote import numero_valido

LIMITE_BYTES = 5 * 1024 * 1024
LIMITE_LINHAS = 20_000

_CHAVES_NOME = ("nome", "name", "responsavel", "cliente", "contato", "aluno", "lead")
_CHAVES_TEL = ("telefone", "celular", "whatsapp", "whats", "fone", "phone", "numero", "tel", "movel")

EXEMPLOS = [
    ("Maria Silva", "11 98765-4321"),
    ("João Pereira", "(21) 99999-8888"),
    ("Ana Souza", "5511912345678"),
]

COMO_PREENCHER = (
    "Uma linha por contato. Coluna A = nome, coluna B = telefone com DDD "
    "(com ou sem 55, parênteses ou traço). Número repetido sai uma vez."
)


class ArquivoInvalido(ValueError):
    pass


def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()


def _celula(v) -> str:
    """Valor de célula como texto. Telefone guardado como NÚMERO no Excel chega 5511987654321.0
    (ou em notação científica): o `.0` sai, o número inteiro fica."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return ""
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    if isinstance(v, int):
        return str(v)
    return str(v).strip()


def _decodificar(dados: bytes) -> str:
    for cod in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return dados.decode(cod)
        except UnicodeDecodeError:
            continue
    raise ArquivoInvalido("Não consegui ler o texto do arquivo")


def _linhas_csv(dados: bytes) -> list[list[str]]:
    texto = _decodificar(dados)
    amostra = texto[:4096]
    try:
        dialeto = csv.Sniffer().sniff(amostra, delimiters=";,\t|")
        sep = dialeto.delimiter
    except csv.Error:
        # Sem padrão claro: o separador que mais aparece; uma coluna só também vale.
        contagem = {s: amostra.count(s) for s in (";", "\t", ",", "|")}
        sep = max(contagem, key=contagem.get) if any(contagem.values()) else ";"
    return [[c.strip() for c in linha] for linha in csv.reader(io.StringIO(texto), delimiter=sep)]


def _linhas_xlsx(dados: bytes) -> list[list[str]]:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001 — arquivo corrompido ou protegido
        raise ArquivoInvalido("Não consegui abrir a planilha (.xlsx)") from e
    try:
        ws = wb.worksheets[0]
        return [[_celula(v) for v in linha] for linha in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


def _linhas_xls(dados: bytes) -> list[list[str]]:
    try:
        import xlrd
    except ImportError as e:  # pragma: no cover — dependência do requirements
        raise ArquivoInvalido("Planilha .xls antiga não suportada aqui; salve como .xlsx ou .csv") from e
    try:
        wb = xlrd.open_workbook(file_contents=dados)
    except Exception as e:  # noqa: BLE001
        raise ArquivoInvalido("Não consegui abrir a planilha (.xls)") from e
    ws = wb.sheet_by_index(0)
    return [[_celula(ws.cell_value(r, c)) for c in range(ws.ncols)] for r in range(ws.nrows)]


def ler_arquivo(nome: str, dados: bytes) -> list[list[str]]:
    """As linhas (células) da 1ª aba / do CSV. O tipo vem do CONTEÚDO, com a extensão de reserva:
    planilha salva com o nome errado ainda abre."""
    if not dados:
        raise ArquivoInvalido("Arquivo vazio")
    if len(dados) > LIMITE_BYTES:
        raise ArquivoInvalido("Arquivo maior que 5 MB")
    ext = (nome or "").lower().rsplit(".", 1)[-1] if "." in (nome or "") else ""
    if dados[:4] == b"PK\x03\x04":
        return _linhas_xlsx(dados)
    if dados[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return _linhas_xls(dados)
    if ext in ("xlsx", "xls"):
        raise ArquivoInvalido("O arquivo não parece uma planilha do Excel")
    return _linhas_csv(dados)


def _coluna(cabecalho: list[str], chaves: tuple[str, ...]) -> int | None:
    norm = [_sem_acento(c) for c in cabecalho]
    for chave in chaves:  # a ordem das chaves é a preferência («telefone» antes de «tel»)
        for i, c in enumerate(norm):
            if c == chave or c.startswith(chave + " ") or c.startswith(chave + "_") or chave in c.split():
                return i
    for chave in chaves:
        for i, c in enumerate(norm):
            if chave in c:
                return i
    return None


def _eh_cabecalho(linha: list[str]) -> bool:
    if any(numero_valido(c) for c in linha if c):
        return False
    return _coluna(linha, _CHAVES_TEL) is not None or _coluna(linha, _CHAVES_NOME) is not None


def para_texto(linhas: list[list[str]]) -> dict:
    """Linhas de planilha → o texto da caixa (uma linha por contato). Com cabeçalho, só as colunas
    de nome e telefone; sem cabeçalho, todas as células (a leitura acha o telefone onde estiver)."""
    linhas = [ln for ln in linhas if any((c or "").strip() for c in ln)]
    col_nome = col_tel = None
    cabecalho: list[str] | None = None
    if linhas and _eh_cabecalho(linhas[0]):
        cabecalho = linhas[0]
        col_nome = _coluna(cabecalho, _CHAVES_NOME)
        col_tel = _coluna(cabecalho, _CHAVES_TEL)
        linhas = linhas[1:]
    cortado = len(linhas) > LIMITE_LINHAS
    saida: list[str] = []
    for ln in linhas[:LIMITE_LINHAS]:
        if col_tel is not None:
            tel = ln[col_tel] if col_tel < len(ln) else ""
            nome = ln[col_nome] if col_nome is not None and col_nome < len(ln) else ""
            partes = [p for p in (nome, tel) if p]
        else:
            partes = [c for c in ln if c]
        if partes:
            # TAB entre as colunas; tira TAB/quebra de dentro da célula para não partir a linha.
            saida.append("\t".join(re.sub(r"[\t\r\n]+", " ", p) for p in partes))
    return {
        "texto": "\n".join(saida),
        "linhas": len(saida),
        "cortado": cortado,
        "colunas": {
            "nome": cabecalho[col_nome] if cabecalho is not None and col_nome is not None else None,
            "telefone": cabecalho[col_tel] if cabecalho is not None and col_tel is not None else None,
        },
    }


def modelo_csv() -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(["nome", "telefone"])
    w.writerows(EXEMPLOS)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def modelo_xlsx() -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "Contatos"
    ws.append(["nome", "telefone"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for nome, tel in EXEMPLOS:
        ws.append([nome, tel])
    # Telefone como TEXTO: digitado como número, o Excel tira o 0, arredonda e vira 5,51E+12.
    for linha in ws.iter_rows(min_row=2, max_row=500, min_col=2, max_col=2):
        for c in linha:
            c.number_format = "@"
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 22
    ws["D1"] = "Como preencher"
    ws["D1"].font = Font(bold=True)
    ws["D2"] = COMO_PREENCHER
    ws.column_dimensions["D"].width = 70
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
