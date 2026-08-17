"""Testes de unidade das agenda tools — lógica PURA (sem HTTP, sem banco).

Cobre: slugify de labels, montagem dinâmica dos schemas a partir da config REAL da
agenda (fixture espelhando o GET /crm-agenda/ccda de produção), pré-checagem de
obrigatórios (REGRA DURA) e montagem do payload do POST /agendar (extras de volta a
`respostas_extras` com o label original + telefone com fallback pro canal).
"""

from services.agenda_tools import (
    _slugify,
    build_agendar_payload,
    build_tool_schemas,
    missing_required_fields,
    summarize_slots,
)

# Espelho (enxuto) da config real de produção — GET /api/crm-agenda/ccda
CCDA_CONFIG = {
    "slug": "ccda",
    "titulo": "Agende sua visita",
    "duracao_min": 30,
    "assuntos": [
        {"nome": "Jardim I - Educação Infantil", "duracao_min": 30},
        {"nome": "1º Ano - Ensino Fundamental I", "duracao_min": 30},
        {"nome": "3ª Série - Ensino Médio", "duracao_min": 30},
    ],
    "labels": {"nome": "Nome completo do responsável", "empresa": "Nome completo do aluno"},
    "perguntas_extras": [
        {"label": "Como conheceu o Colégio?", "obrigatoria": True},
        {"label": "Por que deseja mudar de Escola?", "obrigatoria": True},
    ],
    "local": "Rua Orense, 531 - Centro, Diadema/SP",
    "timezone": "America/Sao_Paulo",
}


def _fn(schema: dict) -> dict:
    return schema["function"]


def test_slugify_remove_acentos_e_pontuacao():
    assert _slugify("Como conheceu o Colégio?") == "como_conheceu_o_colegio"
    assert _slugify("Por que deseja mudar de Escola?") == "por_que_deseja_mudar_de_escola"
    assert _slugify("  ") == "campo"
    assert _slugify("Ano letivo (2026/2027)") == "ano_letivo_2026_2027"


def test_build_tool_schemas_nomes_e_gate_de_obrigatorios():
    schemas, extras_map = build_tool_schemas("ccda", CCDA_CONFIG)
    assert [_fn(s)["name"] for s in schemas] == ["consultar_horarios_visita", "agendar_visita"]

    consultar = _fn(schemas[0])
    assert consultar["parameters"]["required"] == ["data"]

    agendar = _fn(schemas[1])
    props = agendar["parameters"]["properties"]
    required = agendar["parameters"]["required"]

    # base + série + as 2 perguntas obrigatórias da agenda
    assert {"inicio", "nome", "empresa", "assunto"}.issubset(set(required))
    assert "como_conheceu_o_colegio" in required
    assert "por_que_deseja_mudar_de_escola" in required
    # telefone/email NÃO são obrigatórios (telefone cai no do canal)
    assert "telefone" not in required
    assert "email" not in required

    # enum de assunto vem da agenda, verbatim
    assert props["assunto"]["enum"] == [
        "Jardim I - Educação Infantil",
        "1º Ano - Ensino Fundamental I",
        "3ª Série - Ensino Médio",
    ]
    # rótulos da agenda aparecem nas descrições (nada de CCDA hardcoded no código)
    assert "Nome completo do responsável" in props["nome"]["description"]
    assert "Nome completo do aluno" in props["empresa"]["description"]

    # extras_map preserva o label ORIGINAL (o POST casa resposta por label exato)
    assert extras_map == {
        "como_conheceu_o_colegio": "Como conheceu o Colégio?",
        "por_que_deseja_mudar_de_escola": "Por que deseja mudar de Escola?",
    }


def test_build_tool_schemas_sem_labels_nem_extras():
    schemas, extras_map = build_tool_schemas("x", {"titulo": "Reunião", "assuntos": []})
    agendar = _fn(schemas[1])
    assert extras_map == {}
    # sem label de empresa → campo não vira obrigatório
    assert "empresa" not in agendar["parameters"]["required"]
    assert "enum" not in agendar["parameters"]["properties"]["assunto"]


def test_missing_required_fields_regra_dura():
    schemas, _ = build_tool_schemas("ccda", CCDA_CONFIG)
    agendar = schemas[1]
    args = {
        "inicio": "2026-08-20T09:40:00-03:00",
        "nome": "Maria Souza",
        "empresa": "",  # vazio conta como faltando
        "assunto": "Jardim I - Educação Infantil",
        "como_conheceu_o_colegio": "Indicação",
    }
    faltam = missing_required_fields(args, agendar)
    assert faltam == ["empresa", "por_que_deseja_mudar_de_escola"]

    args["empresa"] = "João Souza"
    args["por_que_deseja_mudar_de_escola"] = "Mudança de bairro"
    assert missing_required_fields(args, agendar) == []


def test_build_agendar_payload_mapeia_extras_e_telefone_do_canal():
    _, extras_map = build_tool_schemas("ccda", CCDA_CONFIG)
    args = {
        "inicio": "2026-08-20T09:40:00-03:00",
        "nome": "Maria Souza",
        "empresa": "João Souza",
        "assunto": "Jardim I - Educação Infantil",
        "como_conheceu_o_colegio": "Indicação de amigos",
        "por_que_deseja_mudar_de_escola": "Mudança de bairro",
    }
    body = build_agendar_payload(args, extras_map, customer_phone="5511998887766")
    assert body["inicio"] == "2026-08-20T09:40:00-03:00"
    assert body["nome"] == "Maria Souza"
    assert body["empresa"] == "João Souza"
    assert body["assunto"] == "Jardim I - Educação Infantil"
    # sem telefone nos args → identidade do CANAL entra no payload
    assert body["telefone"] == "5511998887766"
    assert "email" not in body
    # extras voltam com o label ORIGINAL da agenda
    assert body["respostas_extras"] == [
        {"label": "Como conheceu o Colégio?", "resposta": "Indicação de amigos"},
        {"label": "Por que deseja mudar de Escola?", "resposta": "Mudança de bairro"},
    ]


def test_build_agendar_payload_prioriza_telefone_informado_na_conversa():
    _, extras_map = build_tool_schemas("ccda", CCDA_CONFIG)
    body = build_agendar_payload(
        {"inicio": "x", "nome": "y", "assunto": "z", "telefone": "(11) 91234-5678"},
        extras_map,
        customer_phone="5511998887766",
    )
    assert body["telefone"] == "11912345678"


def test_summarize_slots_filtra_disponiveis_e_marca_agendaveis():
    payload = {
        "duracao_min": 30,
        "timezone": "America/Sao_Paulo",
        "de": "2026-08-17",
        "ate": "2026-08-23",
        "slots": [
            {"dia": "2026-08-20", "hora": "08:00", "inicio": "2026-08-20T08:00:00-03:00", "disponivel": False, "motivo": "passado"},
            {"dia": "2026-08-20", "hora": "09:40", "inicio": "2026-08-20T09:40:00-03:00", "disponivel": True},
            {"dia": "2026-08-21", "hora": "10:30", "inicio": "2026-08-21T10:30:00-03:00", "disponivel": True},
        ],
    }
    out = summarize_slots(payload, "2026-08-20")
    # marcador que liga o freio denies_slots do tier_engine
    assert "AGENDÁVEIS" in out["status"]
    assert out["dias"] == [
        {"dia": "2026-08-20", "horarios": [{"hora": "09:40", "inicio": "2026-08-20T09:40:00-03:00"}]},
        {"dia": "2026-08-21", "horarios": [{"hora": "10:30", "inicio": "2026-08-21T10:30:00-03:00"}]},
    ]


def test_summarize_slots_sem_disponibilidade_nao_marca_agendaveis():
    out = summarize_slots({"de": "2026-08-17", "ate": "2026-08-23", "slots": []}, "2026-08-20")
    assert "aviso" in out
    assert "AGENDÁVEIS" not in str(out.get("status", ""))
