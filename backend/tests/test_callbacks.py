"""Callbacks por agente (11/11/2026, CCDA) — mensagens com hora marcada depois de uma fala do agente.

Cobre: a configuração do CCDA validando sem erro, cada gatilho (link do valor, Ensino Médio, silêncio
do contato, depois do tour), o relógio (antes/no prazo/atrasado), cancelamento quando o contato ou a
equipe escreve, frase que encerra a conversa, intervalo entre dois passos vencidos juntos, link virando
duas mensagens na ordem, e o ciclo contra um SQLite de verdade: uma vez por conversa por passo,
conversa assumida (e contato com conversa assumida), IA desligada, descadastro, janela de 24 h do
oficial, visita marcada, falha de envio sem repetição, corrida de reserva e a cascata ignorando o
callback ao ler a última fala.

🚨 `asyncio.get_event_loop().run_until_complete(...)`, nunca `asyncio.run()`: o `run` fecha o laço
global e quebra os testes vizinhos que usam o mesmo padrão.
"""

import asyncio
import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import scheduler
from core.db import Base
from models import (
    TaAgent,
    TaCallbackEnvio,
    TaConnector,
    TaConversation,
    TaMessageLog,
    TaRuntimeParam,
    TaTenant,
    TaWaDescadastro,
)
from services import callbacks as C
from services import proactive

# A configuração que vai para o agente 26 (ta_runtime_param escopo='agent', key='callbacks').
CCDA = json.loads(
    r"""{
  "ativo": true,
  "tolerancia_min": 30,
  "intervalo_minimo_min": 10,
  "janela": {"inicio": "08:00", "fim": "21:30", "tz": "America/Sao_Paulo"},
  "parar_se_visita_marcada": true,
  "parar_se_agente_disse": [
    "Trabalhe Conosco",
    "vagas.solides.com.br",
    "apenas para informação de matrículas novas",
    "assunto pedagógico",
    "horário vc agendou",
    "horário você agendou",
    "agendou a visita",
    "Obrigada pela confirmação",
    "sua visita está agendada",
    "sua visita ao CCDA está confirmada",
    "fez a matrícula",
    "alunos já matriculados",
    "nova escola",
    "outra escola"
  ],
  "passos": [
    {
      "id": "ensino_medio_video",
      "gatilho": {"tipo": "fala_do_agente", "contem": ["valor-1_2_3_serie", "não ficam abaixo de R$2.000"]},
      "atraso_min": 30,
      "mensagens": [
        "Vou te mandar um vídeo super legal e completo que explica um pouquinho mais sobre o nosso Ensino Médio.",
        "https://youtu.be/7zjVB2Z1Ah4"
      ],
      "pular_se_ja_enviado": "youtu.be/7zjVB2Z1Ah4"
    },
    {
      "id": "proposta",
      "gatilho": {
        "tipo": "fala_do_agente",
        "contem": ["ccda.com.br/valor-"],
        "nao_contem": ["valor-1_2_3_serie", "não ficam abaixo de R$2.000"]
      },
      "atraso_min": 30,
      "mensagens": [
        "A proposta fez sentido para você? Conseguiu verificar todos os benefícios oferecidos e valor de investimento? Conseguiu agendar a sua visita? 🥰"
      ]
    },
    {
      "id": "tour",
      "gatilho": {"tipo": "silencio_do_contato"},
      "so_conversa_iniciada_pelo_contato": true,
      "exige_fala_do_agente": ["ccda.com.br/valor-"],
      "atraso_min": 60,
      "mensagens": [
        "Temos muitas outras novidades que você conhecerá pessoalmente, mas vou te passar um vídeo com uma completa apresentação do nosso Colégio, é muito importante que assista, lhe esclarecerá algumas dúvidas e é bem rapidinho.",
        "https://youtu.be/yJ9lZV-6_P8"
      ],
      "pular_se_ja_enviado": "youtu.be/yJ9lZV-6_P8"
    },
    {
      "id": "fechamento",
      "gatilho": {"tipo": "depois_do_passo", "passo": "tour"},
      "so_conversa_iniciada_pelo_contato": true,
      "atraso_min": 30,
      "mensagens": [
        "Antes de matricular o seu filho(a) em qualquer outro Colégio, venha nos fazer uma visita, sem compromisso, tenho certeza que você irá Amar nossa Infraestrutura, Atendimento, Ensino, Diferenciais e Benefícios, oferecemos um ensino que nenhum outro Colégio da região oferecerá."
      ]
    }
  ]
}"""
)
# A mesma, sem a janela e sem a exigência do link do valor no tour: os testes de MECÂNICA (relógio,
# cancelamento, ciclo) não dependem da hora em que a suíte roda nem do caminho da proposta. As travas
# de «quem recebe» têm os testes delas, com a configuração do CCDA inteira (seção 6).
BASE = json.loads(json.dumps(CCDA))
del BASE["janela"]
for _p in BASE["passos"]:
    _p.pop("exige_fala_do_agente", None)

ABERTURA = "Oi meu nome é Cinthia trabalho no relacionamento com os pais aqui no CCDA. Para qual ano vc gostaria de informações?"
LINK_7 = (
    "https://www.ccda.com.br/valor-7_ano/\n\nNo 7º ano, aprofundamos os conteúdos e desenvolvemos o pensamento "
    "analítico.\n\nNo link que enviei vc conseguirá verificar o valor da mensalidade, benefícios, diferenciais e "
    "agendar a sua visita, só clicar."
)
LINK_EM = (
    "https://www.ccda.com.br/valor-1_2_3_serie/\n\nNosso Ensino Médio é único na região: utilizamos o material "
    "ETAPA com o Novo Ensino Médio."
)
T0 = datetime(2026, 11, 11, 14, 0)


def _cfg(bruto=None):
    cfg, erros = C.carregar_config(bruto if bruto is not None else BASE)
    assert erros == [], erros
    return cfg


def _m(role, texto, minutos, model_used=None):
    return C.Msg(role=role, content=texto, model_used=model_used, em=T0 + timedelta(minutes=minutos))


def _cb(passo, texto, minutos):
    return _m("assistant", texto, minutos, f"Callback · {passo}")


def _vencido(msgs, minutos, enviados=None, cfg=None):
    av = C.avaliar(cfg or _cfg(), msgs, enviados or {}, T0 + timedelta(minutes=minutos))
    return (av.vencido.passo.id if av.vencido else None), av.motivos


# ─── 1. Configuração ─────────────────────────────────────────────────────────


def test_configuracao_do_ccda_valida_sem_erro():
    cfg = _cfg(CCDA)
    assert [p.id for p in cfg.passos] == ["ensino_medio_video", "proposta", "tour", "fechamento"]
    assert cfg.passos[3].gatilho.passo == "tour"
    # o texto do cliente, literal
    assert cfg.passos[1].mensagens[0].endswith("Conseguiu agendar a sua visita? 🥰")
    # quem recebe: tour e fechamento só em conversa aberta pelo contato; tour só depois do valor
    assert [p.so_conversa_iniciada_pelo_contato for p in cfg.passos] == [False, False, True, True]
    assert cfg.passos[2].exige_fala_do_agente == ("ccda.com.br/valor-",)
    assert (str(cfg.janela.inicio), str(cfg.janela.fim), cfg.janela.tz) == ("08:00:00", "21:30:00", "America/Sao_Paulo")


def test_configuracao_vem_do_banco_como_texto():
    cfg, erros = C.carregar_config(json.dumps(CCDA, ensure_ascii=False))
    assert erros == [] and len(cfg.passos) == 4


@pytest.mark.parametrize(
    ("bruto", "pedaco"),
    [
        ("", "vazia"),
        ("{nao e json", "JSON inválido"),
        ([], "objeto JSON"),
        ({"passos": []}, "ao menos um passo"),
        (
            {"passos": [{"id": "x", "gatilho": {"tipo": "qualquer"}, "atraso_min": 5, "mensagens": ["oi"]}]},
            "gatilho.tipo",
        ),
        (
            {"passos": [{"id": "x", "gatilho": {"tipo": "fala_do_agente"}, "atraso_min": 5, "mensagens": ["oi"]}]},
            "contem",
        ),
        ({"passos": [{"id": "x", "gatilho": {"tipo": "silencio_do_contato"}, "mensagens": ["oi"]}]}, "atraso_min"),
        (
            {"passos": [{"id": "x", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 5, "mensagens": []}]},
            "mensagens",
        ),
        (
            {
                "passos": [
                    {"id": "X y", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 5, "mensagens": ["a"]}
                ]
            },
            ".id",
        ),
        (
            {
                "passos": [
                    {"id": "x", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 2000, "mensagens": ["a"]}
                ]
            },
            "atraso_min",
        ),
    ],
)
def test_configuracao_invalida_diz_o_que_esta_errado(bruto, pedaco):
    cfg, erros = C.carregar_config(bruto)
    assert cfg is None
    assert any(pedaco in e for e in erros), erros


def test_passo_invalido_cai_e_os_outros_seguem():
    bruto = {
        "passos": [
            {"id": "bom", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 60, "mensagens": ["a"]},
            {
                "id": "ruim",
                "gatilho": {"tipo": "depois_do_passo", "passo": "nao_existe"},
                "atraso_min": 5,
                "mensagens": ["b"],
            },
        ]
    }
    cfg, erros = C.carregar_config(bruto)
    assert [p.id for p in cfg.passos] == ["bom"]
    assert any("gatilho.passo" in e for e in erros)


def test_dependente_de_passo_invalido_e_avisado():
    bruto = {
        "passos": [
            {"id": "tour", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 60, "mensagens": []},
            {
                "id": "fim",
                "gatilho": {"tipo": "depois_do_passo", "passo": "tour"},
                "atraso_min": 30,
                "mensagens": ["b"],
            },
        ]
    }
    cfg, erros = C.carregar_config(bruto)
    assert [p.id for p in cfg.passos] == ["fim"]
    assert any("depende de «tour»" in e for e in erros)


# ─── 2. Gatilhos e relógio ──────────────────────────────────────────────────


def test_proposta_sai_30_min_depois_do_link_do_valor():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1), _m("user", "7 ano", 2), _m("assistant", LINK_7, 2.1)]
    assert _vencido(msgs, 2.1 + 29.9)[0] is None
    assert _vencido(msgs, 2.1 + 29.9)[1]["proposta"] == "aguardando"
    assert _vencido(msgs, 2.1 + 30)[0] == "proposta"


def test_ensino_medio_manda_o_video_e_nao_a_pergunta_da_proposta():
    msgs = [_m("user", "1 ano do medio", 0), _m("assistant", LINK_EM, 0.1)]
    passo, motivos = _vencido(msgs, 30.2)
    assert passo == "ensino_medio_video"
    # a fala do EM tem o link do valor, mas a proposta não dispara nela
    av = C.avaliar(
        _cfg(),
        msgs,
        {"ensino_medio_video": C.Envio("enviado", T0 + timedelta(minutes=30.2))},
        T0 + timedelta(minutes=45),
    )
    assert av.motivos["proposta"] == "sem_gatilho"


def test_ensino_medio_pela_mensagem_do_valor_sem_link():
    fala = "Mas, para que você tenha uma ideia, as mensalidades para o Ensino Médio não ficam abaixo de R$2.000,00."
    msgs = [_m("user", "e o valor?", 0), _m("assistant", fala, 0.1)]
    assert _vencido(msgs, 31)[0] == "ensino_medio_video"


def test_video_do_ensino_medio_ja_mandado_pela_ia_nao_repete():
    fala = (
        LINK_EM
        + "\n\nVc pode ver os detalhes e a qualidade do nosso ensino médio nesse video:\nhttps://youtu.be/7zjVB2Z1Ah4"
    )
    msgs = [_m("user", "medio", 0), _m("assistant", fala, 0.1)]
    passo, motivos = _vencido(msgs, 31)
    assert passo is None and motivos["ensino_medio_video"] == "ja_enviado"


def test_comparacao_sem_acento_e_sem_caixa():
    fala = "Mas as mensalidades para o Ensino Médio NAO FICAM ABAIXO DE R$2.000,00."
    assert _vencido([_m("user", "x", 0), _m("assistant", fala, 0.1)], 31)[0] == "ensino_medio_video"


def test_contato_respondeu_depois_do_link_cancela_a_proposta():
    msgs = [
        _m("user", "7", 0),
        _m("assistant", LINK_7, 0.1),
        _m("user", "vou ver", 5),
        _m("assistant", "Combinado!", 5.1),
    ]
    passo, motivos = _vencido(msgs, 31)
    assert passo is None and motivos["proposta"] == "respondeu_depois"


def test_link_reenviado_mais_tarde_arma_de_novo():
    msgs = [
        _m("user", "7", 0),
        _m("assistant", LINK_7, 0.1),
        _m("user", "e o valor?", 10),
        _m("assistant", LINK_7, 10.1),
    ]
    assert _vencido(msgs, 31)[0] is None  # 30 min do PRIMEIRO link não vale: houve resposta
    assert _vencido(msgs, 40.2)[0] == "proposta"


def test_equipe_escreveu_depois_do_link_cancela():
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1), _m("agent", "Oi, aqui é a Débora", 3)]
    assert _vencido(msgs, 31)[1]["proposta"] == "respondeu_depois"


def test_tour_sai_1h_depois_da_ultima_mensagem_do_contato():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1)]
    assert _vencido(msgs, 59.9)[0] is None
    assert _vencido(msgs, 60)[0] == "tour"


def test_tour_nao_sai_se_a_ia_nao_respondeu_o_contato():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1), _m("user", "alguém?", 5)]
    passo, motivos = _vencido(msgs, 70)
    assert passo is None and motivos["tour"] == "ia_nao_respondeu"


def test_tour_nao_sai_se_a_equipe_respondeu_o_contato():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1), _m("agent", "Oi! Sou a Débora", 2)]
    assert _vencido(msgs, 70)[1]["tour"] == "equipe_respondeu"


def test_mensagem_no_mesmo_segundo_conta_pela_ordem_de_gravacao():
    """A resposta da IA cai no mesmo segundo da pergunta: vale a ordem do log, não o relógio."""
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0)]
    assert _vencido(msgs, 60)[0] == "tour"


def test_caminho_completo_do_robo_antigo_proposta_tour_fechamento():
    """Família some depois do link: 30 min proposta, 1 h tour (texto + link), +30 min fechamento."""
    msgs = [_m("user", "7 ano", 0), _m("assistant", LINK_7, 0.1)]
    assert _vencido(msgs, 30.1)[0] == "proposta"
    msgs.append(_cb("proposta", "A proposta fez sentido?", 30.1))
    env = {"proposta": C.Envio("enviado", T0 + timedelta(minutes=30.1))}
    assert _vencido(msgs, 59.9, env)[0] is None
    assert _vencido(msgs, 60, env)[0] == "tour"
    msgs += [_cb("tour", "Temos muitas outras novidades", 60), _cb("tour", "https://youtu.be/yJ9lZV-6_P8", 60.02)]
    env["tour"] = C.Envio("enviado", T0 + timedelta(minutes=60.03))
    assert _vencido(msgs, 89.9, env)[0] is None
    assert _vencido(msgs, 90.02, env)[0] == "fechamento"  # conta do LINK do tour


def test_contato_respondeu_ao_tour_cancela_o_fechamento():
    msgs = [
        _m("user", "oi", 0),
        _m("assistant", ABERTURA, 0.1),
        _cb("tour", "Temos", 60),
        _cb("tour", "https://youtu.be/yJ9lZV-6_P8", 60),
    ]
    msgs.append(_m("user", "vi o vídeo", 70))
    env = {"tour": C.Envio("enviado", T0 + timedelta(minutes=60))}
    assert _vencido(msgs, 95, env)[1]["fechamento"] == "respondeu_depois"


def test_fechamento_nao_sai_sem_o_tour():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1)]
    falhou = {"tour": C.Envio("falhou", None)}
    passo, motivos = _vencido(msgs, 95, falhou)
    assert passo is None and motivos["fechamento"] == "passo_anterior_nao_saiu"


def test_callback_nao_vira_gatilho_dele_mesmo():
    """A mensagem do callback tem link do valor? Não arma a proposta: só fala da IA arma."""
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1), _cb("x", "https://www.ccda.com.br/valor-7_ano/", 61)]
    assert _vencido(msgs, 95)[1]["proposta"] == "sem_gatilho"


# ─── 3. Parada, uma vez só, atraso, cruzamento ───────────────────────────────


def test_uma_vez_por_conversa_por_passo():
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1)]
    env = {"proposta": C.Envio("falhou", None)}
    passo, motivos = _vencido(msgs, 31, env)
    assert passo is None and motivos["proposta"] == "ja_feito"


@pytest.mark.parametrize(
    "fala",
    [
        "Por favor, envie seu currículo em nosso site na área Trabalhe Conosco acessando o link abaixo.",
        "Esse WhatsApp é apenas para informação de matrículas novas, para outras informações, ligue 4 043 0461.",
        "Como esse é um assunto pedagógico, sugiro ligar no 4 043 0461.",
        "Ótimo! Pra qual horário vc agendou a visita?",
        "Obrigada pela confirmação! Te esperamos.",
    ],
)
def test_frase_que_encerra_cala_todos_os_passos(fala):
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1), _m("user", "x", 1), _m("assistant", fala, 1.1)]
    passo, motivos = _vencido(msgs, 70)
    assert passo is None and motivos == {"*": "encerrada"}


def test_modelo_de_visita_da_equipe_tambem_encerra():
    msgs = [
        _m(
            "agent",
            "Olá, Maria! Aqui é a Nathalia do CCDA. Passando para confirmar que sua visita está agendada para 12/11",
            -60,
            "Disparo · confirmacao",
        ),
        _m("user", "obrigada", 0),
        _m("assistant", "Obrigada! Se tiver alguma dúvida sobre a visita, é só me falar.", 0.1),
    ]
    assert _vencido(msgs, 70)[1] == {"*": "encerrada"}


def test_passo_vencido_ha_mais_que_a_tolerancia_nao_sai():
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1)]
    assert _vencido(msgs, 0.1 + 30 + 30)[0] == "proposta"  # no limite ainda vale
    passo, motivos = _vencido(msgs, 0.1 + 30 + 30.1)
    assert motivos["proposta"] == "atrasado"
    assert passo == "tour"  # o tour (1 h) ainda está no prazo


def test_dois_vencidos_juntos_saem_um_por_vez_com_intervalo():
    """IA desligada segurou a proposta; ela e o tour vencem juntos — sai a proposta, o tour espera."""
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1)]
    assert _vencido(msgs, 60.05)[0] == "proposta"
    msgs.append(_cb("proposta", "A proposta fez sentido?", 60.05))
    env = {"proposta": C.Envio("enviado", T0 + timedelta(minutes=60.05))}
    passo, motivos = _vencido(msgs, 61, env)
    assert passo is None and motivos["tour"] == "intervalo"
    assert _vencido(msgs, 70.1, env)[0] == "tour"


def test_desligado_nao_avalia_nada():
    cfg = _cfg({**CCDA, "ativo": False})
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1)]
    assert C.avaliar(cfg, msgs, {}, T0 + timedelta(minutes=31)).motivos == {"*": "desligado"}


def test_janela_de_24h_do_oficial():
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1)]
    assert C.janela_aberta(msgs, T0 + timedelta(hours=23, minutes=59))
    assert not C.janela_aberta(msgs, T0 + timedelta(hours=24))
    assert not C.janela_aberta([_m("agent", "modelo", 0)], T0)  # contato nunca escreveu: sem janela


# ─── 4. Texto e link separados ───────────────────────────────────────────────


def test_texto_com_link_vira_duas_mensagens_na_ordem():
    saida = C.separar_links(["Vc pode ver nesse vídeo: https://youtu.be/7zjVB2Z1Ah4", "Até já!"])
    assert saida == ["Vc pode ver nesse vídeo:", "https://youtu.be/7zjVB2Z1Ah4", "Até já!"]


def test_link_sozinho_e_texto_sem_link_ficam_como_estao():
    msgs = ["Temos muitas outras novidades.", "https://youtu.be/yJ9lZV-6_P8"]
    assert C.separar_links(msgs) == msgs


def test_pontuacao_colada_no_link_fica_no_texto():
    assert C.separar_links(["Veja https://youtu.be/x."]) == ["Veja.", "https://youtu.be/x"]


def test_nome_do_contato():
    assert C.com_nome("Oi, {nome}! Tudo bem?", "Maria Silva") == "Oi, Maria! Tudo bem?"
    assert C.com_nome("Oi, {nome}! Tudo bem?", None) == "Oi! Tudo bem?"


# ─── 5. O ciclo contra um banco de verdade (SQLite) ──────────────────────────

WA = "5511987654321"
TABELAS = [
    TaTenant,
    TaAgent,
    TaConnector,
    TaConversation,
    TaMessageLog,
    TaRuntimeParam,
    TaWaDescadastro,
    TaCallbackEnvio,
]


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _Db:
    """AsyncSession de mentira por cima de um SQLite em memória: a consulta roda de verdade."""

    def __init__(self, sessao):
        self.s = sessao

    async def execute(self, q, *a, **k):
        return self.s.execute(q, *a, **k)

    def add(self, obj):
        self.s.add(obj)

    async def commit(self):
        self.s.commit()

    async def rollback(self):
        self.s.rollback()

    async def get(self, modelo, id_):
        return self.s.get(modelo, id_)

    def get_bind(self):
        return self.s.get_bind()


@pytest.fixture
def sessao():
    motor = create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[m.__table__ for m in TABELAS])
    with Session(motor, expire_on_commit=False) as s:
        yield s
    motor.dispose()


@pytest.fixture
def envios(monkeypatch):
    """Envios pelo conector, gravados em vez de sair. `falhar` = posições (0, 1…) que falham."""
    reg = {"textos": [], "falhar": set()}

    async def _send(conn, chat, texto, imagem_url=None):
        i = len(reg["textos"])
        reg["textos"].append((conn.id, chat, texto))
        return i not in reg["falhar"]

    monkeypatch.setattr(proactive, "send_text_via_connector", _send)
    monkeypatch.setattr(C, "PAUSA_ENTRE_MENSAGENS_S", 0)
    C._avisados.clear()
    return reg


def _semear(s, *, falas, kind="whatsapp_cloud", status="active", ia_ligada=True, modo="agente", cfg=None, agora=None):
    """Tenant 17, agente 26, número 56, uma conversa com as falas [(role, texto, minutos_atras[, model_used])]."""
    agora = agora or datetime.utcnow()
    s.add(TaTenant(id=17, nome="CCDA", email="ccda@x"))
    s.add(TaAgent(id=26, tenant_id=17, nome="Cinthia", active=True, template_kind=""))
    s.add(TaConnector(id=56, agent_id=26, kind=kind, config_json_enc="x", enabled=True, modo=modo, ia_ligada=ia_ligada))
    s.add(
        TaRuntimeParam(escopo="agent", escopo_id=26, key="callbacks", value=json.dumps(cfg or BASE, ensure_ascii=False))
    )
    ultima_user = min((f[2] for f in falas if f[0] == "user"), default=0)
    s.add(
        TaConversation(
            id=500,
            agent_id=26,
            connector_kind=kind,
            external_id=WA,
            connector_id=56,
            status=status,
            contact_name="Maria Silva",
            msg_count=len(falas),
            last_message_at=agora - timedelta(minutes=ultima_user),
        )
    )
    s.commit()
    for role, texto, atras, *mu in falas:
        s.add(
            TaMessageLog(
                conversation_id=500,
                role=role,
                content=texto,
                model_used=mu[0] if mu else None,
                created_at=agora - timedelta(minutes=atras),
            )
        )
        s.commit()  # um commit por fala: o id segue a ordem


def _log(s):
    return [
        (m.role, m.model_used, m.content) for m in s.execute(select(TaMessageLog).order_by(TaMessageLog.id)).scalars()
    ]


def _linhas(s):
    return [
        (r.passo, r.status, r.motivo) for r in s.execute(select(TaCallbackEnvio).order_by(TaCallbackEnvio.id)).scalars()
    ]


def test_ciclo_manda_a_proposta_grava_na_conversa_e_nao_repete(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    r = _rodar(C.rodar_ciclo(_Db(sessao)))
    assert r["enviados"] == 1
    assert envios["textos"] == [(56, WA, CCDA["passos"][1]["mensagens"][0])]
    assert _log(sessao)[-1] == ("assistant", "Callback · proposta", CCDA["passos"][1]["mensagens"][0])
    assert _linhas(sessao) == [("proposta", "enviado", None)]
    r = _rodar(C.rodar_ciclo(_Db(sessao)))  # minuto seguinte
    assert r["enviados"] == 0 and len(envios["textos"]) == 1


def test_ciclo_tour_sai_em_duas_mensagens_texto_e_link(sessao, envios):
    _semear(sessao, falas=[("user", "oi", 61), ("assistant", ABERTURA, 60.9)])
    _rodar(C.rodar_ciclo(_Db(sessao)))
    assert [t for _c, _w, t in envios["textos"]] == CCDA["passos"][2]["mensagens"]
    assert [x[1] for x in _log(sessao)[-2:]] == ["Callback · tour", "Callback · tour"]
    # 31 min depois: o fechamento, contado do link do tour
    r = _rodar(C.rodar_ciclo(_Db(sessao), agora=datetime.utcnow() + timedelta(minutes=31)))
    assert r["enviados"] == 1 and envios["textos"][-1][2] == CCDA["passos"][3]["mensagens"][0]
    assert _linhas(sessao) == [("tour", "enviado", None), ("fechamento", "enviado", None)]


def test_ciclo_cascata_ignora_o_callback_ao_ler_a_ultima_fala(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    _rodar(C.rodar_ciclo(_Db(sessao)))
    assert _rodar(scheduler._ultima_fala_do_agente(_Db(sessao), 500)) == LINK_7


@pytest.mark.parametrize(
    ("kw", "motivo"),
    [
        ({"ia_ligada": False}, "ia_desligada_ou_fora_do_horario"),
        ({"modo": "registro"}, "numero_em_registro"),
    ],
)
def test_ciclo_numero_sem_ia_nao_manda_nem_consome_o_passo(sessao, envios, kw, motivo):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)], **kw)
    r = _rodar(C.rodar_ciclo(_Db(sessao)))
    assert r["enviados"] == 0 and r["bloqueados"] == {motivo: 1}
    assert envios["textos"] == [] and _linhas(sessao) == []  # religou no prazo: ainda sai


def test_ciclo_conversa_assumida_nao_entra(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)], status="handed_off")
    assert _rodar(C.rodar_ciclo(_Db(sessao)))["conversas"] == 0
    assert envios["textos"] == []


def test_ciclo_contato_com_outra_conversa_assumida_nao_recebe(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    sessao.add(
        TaConversation(
            id=499,
            agent_id=26,
            connector_kind="whatsapp_cloud",
            external_id=WA,
            connector_id=56,
            status="handed_off",
            msg_count=9,
            last_message_at=datetime.utcnow() - timedelta(days=1),
        )
    )
    sessao.commit()
    assert _rodar(C.rodar_ciclo(_Db(sessao)))["conversas"] == 0
    assert envios["textos"] == []


def test_ciclo_descadastrado_nao_recebe(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    sessao.add(TaWaDescadastro(tenant_id=17, numero="551187654321", chave="1187654321", texto="Parar Mensagem"))
    sessao.commit()
    r = _rodar(C.rodar_ciclo(_Db(sessao)))
    assert r["bloqueados"] == {"descadastrado": 1} and envios["textos"] == []


def test_ciclo_oficial_fora_da_janela_de_24h_nao_manda_e_loga(sessao, envios, caplog):
    longo = {
        **BASE,
        "tolerancia_min": 120,
        "passos": [
            {"id": "tarde", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 1440, "mensagens": ["Oi de novo"]}
        ],
    }
    _semear(sessao, falas=[("user", "oi", 24 * 60 + 5), ("assistant", ABERTURA, 24 * 60 + 4.9)], cfg=longo)
    with caplog.at_level("INFO", logger="services.callbacks"):
        r = _rodar(C.rodar_ciclo(_Db(sessao)))
        _rodar(C.rodar_ciclo(_Db(sessao)))  # o aviso não se repete a cada minuto
    assert r["bloqueados"] == {"janela_24h_fechada": 1} and envios["textos"] == []
    assert sum("janela_24h_fechada" in m for m in caplog.messages) == 1


def test_ciclo_baileys_nao_tem_janela_de_24h(sessao, envios):
    longo = {
        **BASE,
        "tolerancia_min": 120,
        "passos": [
            {"id": "tarde", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 1440, "mensagens": ["Oi de novo"]}
        ],
    }
    _semear(
        sessao, falas=[("user", "oi", 24 * 60 + 5), ("assistant", ABERTURA, 24 * 60 + 4.9)], cfg=longo, kind="whatsapp"
    )
    assert _rodar(C.rodar_ciclo(_Db(sessao)))["enviados"] == 1


def test_ciclo_visita_marcada_no_crm_nao_recebe(sessao, envios, monkeypatch):
    async def _ctx(_db, _conv):
        return {"visita_marcada": True}

    monkeypatch.setattr(scheduler, "_cascata_contexto", _ctx)
    _semear(sessao, falas=[("user", "oi", 61), ("assistant", ABERTURA, 60.9)])
    r = _rodar(C.rodar_ciclo(_Db(sessao)))
    assert r["bloqueados"] == {"visita_marcada": 1} and envios["textos"] == []


def test_ciclo_falha_no_link_nao_repete_e_nao_arma_o_fechamento(sessao, envios):
    envios["falhar"] = {1}  # o texto sai, o link falha
    _semear(sessao, falas=[("user", "oi", 61), ("assistant", ABERTURA, 60.9)])
    _rodar(C.rodar_ciclo(_Db(sessao)))
    assert _linhas(sessao) == [("tour", "falhou", "envio_parcial")]
    assert [x[2] for x in _log(sessao) if x[1]] == [CCDA["passos"][2]["mensagens"][0]]
    _rodar(C.rodar_ciclo(_Db(sessao), agora=datetime.utcnow() + timedelta(minutes=31)))
    assert len(envios["textos"]) == 2  # nada novo: nem tour de novo, nem fechamento


def test_ciclo_falha_no_primeiro_envio_nao_grava_mensagem(sessao, envios):
    envios["falhar"] = {0}
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    _rodar(C.rodar_ciclo(_Db(sessao)))
    assert _linhas(sessao) == [("proposta", "falhou", "envio_falhou")]
    assert all(x[1] is None for x in _log(sessao))


def test_ciclo_passo_ja_reservado_por_outro_processo_nao_sai(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    sessao.add(TaCallbackEnvio(conversation_id=500, agent_id=26, passo="proposta", status="enviando"))
    sessao.commit()
    assert _rodar(C.rodar_ciclo(_Db(sessao)))["enviados"] == 0 and envios["textos"] == []


def test_ciclo_corrida_na_reserva_nao_manda_duas_vezes(sessao, envios, monkeypatch):
    """Dois containers no deploy: os dois avaliam «vencido»; o único da tabela deixa só um enviar."""
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])

    async def _nada_enviado(_db, _cid):
        return {}  # o outro processo ainda não tinha gravado quando este leu

    monkeypatch.setattr(C, "_enviados", _nada_enviado)
    _rodar(C.rodar_ciclo(_Db(sessao)))
    _rodar(C.rodar_ciclo(_Db(sessao)))
    assert len(envios["textos"]) == 1 and _linhas(sessao) == [("proposta", "enviado", None)]


def test_ciclo_sem_configuracao_nao_olha_conversa(sessao, envios):
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)])
    sessao.query(TaRuntimeParam).delete()
    sessao.commit()
    assert _rodar(C.rodar_ciclo(_Db(sessao))) == {"conversas": 0, "enviados": 0, "bloqueados": {}}


# ─── 6. Quem recebe (12/11/2026) ─────────────────────────────────────────────
# Na véspera o CCDA mandou «visita_perdida_reagendar» a 87 famílias de visita perdida. Das que
# responderam, duas já tinham matriculado, uma escolheu outra escola e duas eram resposta automática
# do WhatsApp comercial do pai — e o tour sairia para todas. Os textos abaixo são as falas reais.

DISPARO = (
    "Olá, Julio! Tudo bem? Aqui é a Nathalia, do CCDA 📚 Vi que vocês não conseguiram vir na visita que estava "
    "agendada, e sentimos a sua falta por aqui. Ainda tenho alguns horários disponíveis em nossa agenda. Segue um "
    "link com os dias, é bem rápido e simples para reagendar: 📅 https://www.ccda.com.br/agendamento-de-visita/ "
    "Algum desses dias fica bom para você?"
)
RESPOSTA_AUTOMATICA = "Olá! Seja bem vindo a Leo Madeiras Diadema ✨ Não estamos disponíveis no momento mas te retorno assim que possivel."
SEM_LINK = "Oi, Jessica! Aqui é a Nathalia, do CCDA. Para qual ano você gostaria de informações?"


def test_marcas_de_modelo_sao_as_do_disparo_oficial():
    from services import disparo_oficial

    assert C.MARCAS_MODELO == (disparo_oficial.MARCA_DISPARO, disparo_oficial.MARCA_MODELO)


@pytest.mark.parametrize("marca", ["Disparo · visita_perdida_reagendar", "Modelo · visita_perdida_reagendar"])
def test_quem_respondeu_ao_modelo_nao_recebe_tour_nem_fechamento(marca):
    msgs = [_m("agent", DISPARO, -5, marca), _m("user", RESPOSTA_AUTOMATICA, 0), _m("assistant", SEM_LINK, 0.1)]
    for cfg in (_cfg(), _cfg(CCDA)):
        passo, motivos = _vencido(msgs, 61, cfg=cfg)
        assert passo is None
        assert motivos["tour"] == motivos["fechamento"] == "aberta_por_nos"


def test_conversa_do_contato_reaberta_por_modelo_nao_recebe_tour():
    """Conversa 1337: o contato abriu, recebeu o valor, depois a equipe mandou o modelo e ele respondeu."""
    msgs = [
        _m("user", "Boa noite", 0),
        _m("assistant", ABERTURA, 0.1),
        _m("user", "8", 3),
        _m("assistant", LINK_7, 3.1),
        _m("agent", DISPARO, 70, "Modelo · visita_perdida_reagendar"),
        _m("user", "Neste momento não tenho interesse.", 95),
        _m("assistant", "Tudo bem, se precisar de mais informações no futuro, estou aqui para ajudar.", 95.1),
    ]
    assert not C.aberta_pelo_contato(msgs)
    assert _vencido(msgs, 156, cfg=_cfg(CCDA))[1]["tour"] == "aberta_por_nos"


def test_equipe_que_abre_a_conversa_tambem_conta_como_nossa():
    msgs = [_m("agent", "Oi, aqui é a Débora do CCDA", 0), _m("user", "oi", 5), _m("assistant", ABERTURA, 5.1)]
    assert _vencido(msgs, 66)[1]["tour"] == "aberta_por_nos"


def test_conversa_aberta_pelo_contato_continua_recebendo():
    msgs = [_m("user", "7 ano", 0), _m("assistant", LINK_7, 0.1), _m("user", "vou ver", 5), _m("assistant", "Ok!", 5.1)]
    assert C.aberta_pelo_contato(msgs)
    assert _vencido(msgs, 65, cfg=_cfg(CCDA))[0] == "tour"


def test_callback_nosso_nao_tira_a_conversa_do_contato():
    msgs = [_m("user", "7 ano", 0), _m("assistant", LINK_7, 0.1), _cb("proposta", "A proposta fez sentido?", 30.1)]
    assert C.aberta_pelo_contato(msgs)


def test_fala_do_agente_ainda_sai_em_conversa_aberta_por_modelo():
    """A trava vale por padrão só para os passos de silêncio: o valor pedido depois do modelo segue o caminho."""
    msgs = [_m("agent", DISPARO, -5, "Disparo · visita_perdida_reagendar"), _m("user", "7 ano", 0)]
    msgs.append(_m("assistant", LINK_7, 0.1))
    assert _vencido(msgs, 30.2, cfg=_cfg(CCDA))[0] == "proposta"


def test_padrao_da_trava_por_tipo_de_gatilho_e_explicito_vence():
    bruto = {
        "passos": [
            {"id": "fala", "gatilho": {"tipo": "fala_do_agente", "contem": ["x"]}, "atraso_min": 5, "mensagens": ["a"]},
            {"id": "silencio", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 60, "mensagens": ["b"]},
            {
                "id": "depois",
                "gatilho": {"tipo": "depois_do_passo", "passo": "silencio"},
                "atraso_min": 5,
                "mensagens": ["c"],
            },
        ]
    }
    cfg = _cfg(bruto)
    assert [p.so_conversa_iniciada_pelo_contato for p in cfg.passos] == [False, True, True]
    bruto["passos"][0]["so_conversa_iniciada_pelo_contato"] = True
    bruto["passos"][1]["so_conversa_iniciada_pelo_contato"] = False
    cfg = _cfg(bruto)
    assert [p.so_conversa_iniciada_pelo_contato for p in cfg.passos] == [True, False, True]
    msgs = [_m("agent", DISPARO, -5, "Disparo · x"), _m("user", "oi", 0), _m("assistant", SEM_LINK, 0.1)]
    assert _vencido(msgs, 61, cfg=cfg)[0] == "silencio"  # desligada de propósito no passo


def test_aberta_vinda_do_banco_vale_sobre_o_historico_cortado():
    """Conversa longa: as últimas mensagens lidas podem começar no meio. O ciclo confere no banco."""
    cfg = _cfg()
    so_o_fim = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1)]
    agora = T0 + timedelta(minutes=61)
    assert C.avaliar(cfg, so_o_fim, {}, agora, aberta=False).motivos["tour"] == "aberta_por_nos"
    fim_com_ia_antes = [_m("assistant", "...", -1), *so_o_fim]
    assert C.avaliar(cfg, fim_com_ia_antes, {}, agora, aberta=True).vencido.passo.id == "tour"


def test_tour_do_ccda_exige_o_link_do_valor():
    sem_valor = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1)]
    passo, motivos = _vencido(sem_valor, 61, cfg=_cfg(CCDA))
    assert passo is None and motivos["tour"] == "sem_fala_exigida"
    com_valor = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1), _m("user", "vou ver", 5), _m("assistant", "Ok", 5.1)]
    assert _vencido(com_valor, 65.1, cfg=_cfg(CCDA))[0] == "tour"


@pytest.mark.parametrize("role", ["callback", "agent"])
def test_exigencia_de_fala_so_conta_a_ia(role):
    """O link do valor num callback nosso ou numa mensagem da equipe não abre o tour: só a fala da IA."""
    link = "Segue o valor: https://www.ccda.com.br/valor-7_ano/"
    fala = _cb("x", link, 1) if role == "callback" else _m("agent", link, 1)
    msgs = [_m("user", "oi", 0), _m("assistant", ABERTURA, 0.1), fala]
    assert _vencido(msgs, 61, cfg=_cfg(CCDA))[1]["tour"] == "sem_fala_exigida"


def test_exige_passo_so_sai_depois_do_passo_enviado():
    bruto = {
        "passos": [
            {
                "id": "a",
                "gatilho": {"tipo": "fala_do_agente", "contem": ["valor-"]},
                "atraso_min": 30,
                "mensagens": ["x"],
            },
            {
                "id": "b",
                "gatilho": {"tipo": "silencio_do_contato"},
                "exige_passo": "a",
                "atraso_min": 60,
                "mensagens": ["y"],
            },
        ]
    }
    cfg = _cfg(bruto)
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1)]
    assert _vencido(msgs, 61, cfg=cfg)[1]["b"] == "sem_passo_exigido"  # «a» venceu e passou do prazo
    falhou = {"a": C.Envio("falhou", None)}
    assert _vencido(msgs, 61, falhou, cfg=cfg)[1]["b"] == "sem_passo_exigido"
    msgs.append(_cb("a", "x", 30.1))
    enviado = {"a": C.Envio("enviado", T0 + timedelta(minutes=30.1))}
    assert _vencido(msgs, 60, enviado, cfg=cfg)[0] == "b"


@pytest.mark.parametrize(
    ("passo_extra", "pedaco"),
    [
        ({"so_conversa_iniciada_pelo_contato": "sim"}, "so_conversa_iniciada_pelo_contato"),
        ({"exige_passo": "nao_existe"}, "exige_passo"),
        ({"exige_passo": "x"}, "exige_passo"),  # ele mesmo
        ({"exige_fala_do_agente": []}, "exige_fala_do_agente"),
        ({"exige_fala_do_agente": "valor-"}, "exige_fala_do_agente"),
    ],
)
def test_trava_invalida_derruba_o_passo(passo_extra, pedaco):
    passo = {"id": "x", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 60, "mensagens": ["a"]}
    cfg, erros = C.carregar_config({"passos": [{**passo, **passo_extra}]})
    assert cfg is None and any(pedaco in e for e in erros), erros


def test_exigencia_de_passo_invalido_e_avisada():
    bruto = {
        "passos": [
            {"id": "a", "gatilho": {"tipo": "silencio_do_contato"}, "atraso_min": 60, "mensagens": []},
            {
                "id": "b",
                "gatilho": {"tipo": "silencio_do_contato"},
                "exige_passo": "a",
                "atraso_min": 60,
                "mensagens": ["y"],
            },
        ]
    }
    cfg, erros = C.carregar_config(bruto)
    assert [p.id for p in cfg.passos] == ["b"] and any("depende de «a»" in e for e in erros)


@pytest.mark.parametrize(
    "fala",
    [
        # conversas 1349 e 1417 (já matriculadas) e 1393 (outra escola), como o agente 26 respondeu
        "Que ótimo saber que você já fez a matrícula do seu filho, Julio! Para assuntos relacionados a alunos já "
        "matriculados, você pode entrar em contato com a secretaria pelo telefone 4 043 0461.",
        "Que ótimo, Bárbara! Fico muito feliz em saber que você já fez a matrícula. Seja bem-vinda ao CCDA!",
        "Entendo, Juscilene. Espero que tudo dê certo com a nova escola. Se no futuro você quiser conhecer mais "
        "sobre o CCDA, estaremos de braços abertos para recebê-los.",
        "Que pena! Espero que a outra escola atenda bem vocês.",
    ],
)
def test_familia_matriculada_ou_de_outra_escola_encerra(fala):
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1), _m("user", "x", 1), _m("assistant", fala, 1.1)]
    assert _vencido(msgs, 70, cfg=_cfg(CCDA))[1] == {"*": "encerrada"}


@pytest.mark.parametrize(
    "fala",
    [
        # respostas comuns de venda do agente 26 (e o modelo do disparo): não podem encerrar
        "Entendo! Para garantir o agendamento, você pode ligar para a secretaria do colégio no número 4 043 0461.",
        "Para matricular no Jardim I, a criança precisa ter 4 anos completos até 31 de março de 2027. Como seu filho "
        "tem 3 anos, ele ainda não pode ser matriculado.",
        "Antes de matricular o seu filho(a) em qualquer outro Colégio, venha nos fazer uma visita, sem compromisso.",
        "Atenção: existe outro colégio abaixo do nosso, não confunda. 😊",
        DISPARO,
    ],
)
def test_resposta_comum_de_venda_nao_encerra(fala):
    msgs = [_m("user", "7", 0), _m("assistant", LINK_7, 0.1), _m("user", "x", 1), _m("assistant", fala, 1.1)]
    assert "*" not in _vencido(msgs, 70, cfg=_cfg(CCDA))[1]


def _brasilia(dia, hhmm):
    """Hora de Brasília (UTC-3, sem horário de verão desde 2019) → UTC sem fuso, como o ciclo usa."""
    h, m = map(int, hhmm.split(":"))
    return datetime(2026, 11, dia, h, m) + timedelta(hours=3)


@pytest.mark.parametrize(
    ("hhmm", "dentro"),
    [("07:59", False), ("08:00", True), ("12:00", True), ("21:29", True), ("21:30", False), ("23:20", False)],
)
def test_janela_08h_as_21h30_de_brasilia(hhmm, dentro):
    janela = _cfg(CCDA).janela
    assert C.dentro_da_janela(janela, _brasilia(12, hhmm)) is dentro
    assert C.dentro_da_janela(None, _brasilia(12, hhmm))  # sem janela: qualquer hora


def test_passo_que_vence_fora_da_janela_nao_sai_nem_depois():
    """Proposta vence 21:40: não sai; às 08:00 já passou da tolerância. Não fica guardada."""
    cfg = _cfg(CCDA)
    link = _brasilia(12, "21:10")
    msgs = [C.Msg("user", "7", None, link), C.Msg("assistant", LINK_7, None, link)]
    av = C.avaliar(cfg, msgs, {}, _brasilia(12, "21:40"))
    assert av.vencido is None and av.motivos["proposta"] == "fora_da_janela"
    assert C.avaliar(cfg, msgs, {}, _brasilia(13, "08:00")).motivos["proposta"] == "atrasado"


def test_passo_que_vence_antes_das_8h_sai_as_8h_se_ainda_no_prazo():
    cfg = _cfg(CCDA)
    link = _brasilia(12, "07:15")
    msgs = [C.Msg("user", "7", None, link), C.Msg("assistant", LINK_7, None, link)]
    assert C.avaliar(cfg, msgs, {}, _brasilia(12, "07:45")).motivos["proposta"] == "fora_da_janela"
    assert C.avaliar(cfg, msgs, {}, _brasilia(12, "08:00")).vencido.passo.id == "proposta"


@pytest.mark.parametrize(
    ("janela", "pedaco"),
    [
        ("08:00-21:30", "janela"),
        ({"inicio": "8h", "fim": "21:30"}, "HH:MM"),
        ({"inicio": "21:30", "fim": "08:00"}, "antes do fim"),
        ({"inicio": "08:00", "fim": "21:30", "tz": "Brasil/Diadema"}, "fuso"),
    ],
)
def test_janela_invalida_derruba_a_configuracao(janela, pedaco):
    """Janela ilegível ignorada = mandar a qualquer hora. Melhor não mandar nada e avisar."""
    cfg, erros = C.carregar_config({**CCDA, "janela": janela})
    assert cfg is None and any(pedaco in e for e in erros), erros


# ─── 7. Quem recebe, no ciclo ────────────────────────────────────────────────

MEIO_DIA = _brasilia(12, "12:00")


def test_ciclo_quem_respondeu_ao_disparo_nao_recebe_o_tour(sessao, envios):
    _semear(
        sessao,
        falas=[
            ("agent", DISPARO, 70, "Disparo · visita_perdida_reagendar"),
            ("user", "Sexta feira ok", 61),
            ("assistant", "Para garantir o horário, é só escolher no link.", 60.9),
        ],
        cfg=CCDA,
        agora=MEIO_DIA,
    )
    r = _rodar(C.rodar_ciclo(_Db(sessao), agora=MEIO_DIA))
    assert r["enviados"] == 0 and envios["textos"] == [] and _linhas(sessao) == []


def test_ciclo_ccda_manda_o_tour_a_quem_abriu_e_recebeu_o_valor(sessao, envios):
    _semear(
        sessao,
        falas=[("user", "7 ano", 95), ("assistant", LINK_7, 94.9), ("user", "vou ver", 61), ("assistant", "Ok!", 60.9)],
        cfg=CCDA,
        agora=MEIO_DIA,
    )
    r = _rodar(C.rodar_ciclo(_Db(sessao), agora=MEIO_DIA))
    assert r["enviados"] == 1 and [t for _c, _w, t in envios["textos"]] == CCDA["passos"][2]["mensagens"]


def test_ciclo_fora_da_janela_nao_manda_nem_reserva(sessao, envios):
    noite = _brasilia(12, "22:00")
    _semear(sessao, falas=[("user", "7 ano", 31), ("assistant", LINK_7, 30.9)], cfg=CCDA, agora=noite)
    r = _rodar(C.rodar_ciclo(_Db(sessao), agora=noite))
    assert r["enviados"] == 0 and envios["textos"] == [] and _linhas(sessao) == []


@pytest.mark.parametrize(
    ("primeira", "sai"),
    [(("agent", DISPARO, 200, "Disparo · x"), False), (("user", "oi", 200), True)],
)
def test_ciclo_conversa_longa_confere_quem_abriu_no_banco(sessao, envios, monkeypatch, primeira, sai):
    """O ciclo lê as últimas N mensagens; a 1ª da conversa (o disparo) ficou de fora do que leu."""
    monkeypatch.setattr(C, "LIMITE_HISTORICO", 2)
    _semear(
        sessao,
        falas=[primeira, ("assistant", "Oi!", 150), ("user", "tudo bem?", 61), ("assistant", "Tudo!", 60.9)],
        agora=MEIO_DIA,
    )
    r = _rodar(C.rodar_ciclo(_Db(sessao), agora=MEIO_DIA))
    assert (r["enviados"] == 1) is sai
