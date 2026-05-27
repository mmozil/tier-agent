"""Templates prontos de playbook — cliente cria 1 deles do zero pra começar.

Cada template é um `dict` no formato `canvas_json`. Endpoint
`POST /playbooks/seed/{template_key}` cria um TaPlaybook usando o template
escolhido + ID do agente do tenant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PlaybookTemplate:
    key: str
    nome: str
    descricao: str
    canvas_json: dict[str, Any]


# ──────────────────────────────────────────────────────────────
# 1. FAQ + Handoff Humano
#    Trigger keyword → LLM busca knowledge → Branch sim/não → Handoff ou encerra
# ──────────────────────────────────────────────────────────────
FAQ_HANDOFF = PlaybookTemplate(
    key="faq_handoff",
    nome="FAQ + Atendimento Humano",
    descricao="Responde dúvidas via IA usando knowledge. Se cliente ficar insatisfeito, escala pra humano.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_keyword",
                "position": {"x": 80, "y": 80},
                "data": {
                    "patterns": ["dúvida", "como funciona", "preço", "quanto custa", "ajuda"],
                    "match": "any",
                    "case_sensitive": False,
                },
            },
            {
                "id": "n_llm",
                "type": "llm_step",
                "position": {"x": 360, "y": 80},
                "data": {
                    "system_prompt": (
                        "Você é o atendente da empresa. Responda a pergunta do cliente "
                        "de forma curta (máx 3 frases), amigável, em pt-BR. "
                        "Use APENAS informações da knowledge cadastrada. "
                        "Se não souber, peça pra reformular a pergunta."
                    ),
                    "user_prompt": "{{message.text}}",
                    "send_text": True,
                    "save_as": "resposta_ia",
                },
            },
            {
                "id": "n_pergunta",
                "type": "send_text",
                "position": {"x": 640, "y": 80},
                "data": {"text": "Resolveu sua dúvida? Responda *sim* ou *não*."},
            },
            {
                "id": "n_wait",
                "type": "wait",
                "position": {"x": 920, "y": 80},
                "data": {"duration_seconds": 90},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 1200, "y": 80},
                "data": {"condition": "{{message.text|lower}} contains 'não'"},
            },
            {
                "id": "n_handoff",
                "type": "handoff_human",
                "position": {"x": 1480, "y": 30},
                "data": {
                    "queue": "suporte",
                    "msg": "Vou chamar um atendente pra te ajudar melhor, ok? Um momento.",
                    "pause_minutes": 60,
                },
            },
            {
                "id": "n_fim",
                "type": "send_text",
                "position": {"x": 1480, "y": 180},
                "data": {"text": "Que ótimo! Qualquer outra dúvida é só chamar. 😊"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_llm"},
            {"id": "e2", "source": "n_llm", "target": "n_pergunta"},
            {"id": "e3", "source": "n_pergunta", "target": "n_wait"},
            {"id": "e4", "source": "n_wait", "target": "n_branch"},
            {"id": "e5", "source": "n_branch", "sourceHandle": "true", "target": "n_handoff"},
            {"id": "e6", "source": "n_branch", "sourceHandle": "false", "target": "n_fim"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 2. Recuperar Carrinho Abandonado
#    Trigger event → wait → cupom → wait → branch(comprou?) → handoff
# ──────────────────────────────────────────────────────────────
RECUPERAR_CARRINHO = PlaybookTemplate(
    key="recuperar_carrinho",
    nome="Recuperar Carrinho",
    descricao="Quando webhook 'pedido_abandonado' chega: espera 1h, manda cupom 10%, espera 24h, escala pra humano se não comprou.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_keyword",
                "position": {"x": 80, "y": 80},
                "data": {
                    "patterns": ["esqueci", "abandonei", "pensar melhor", "depois"],
                    "match": "any",
                },
            },
            {
                "id": "n_wait1",
                "type": "wait",
                "position": {"x": 360, "y": 80},
                "data": {"duration_seconds": 3600},
            },
            {
                "id": "n_cupom",
                "type": "send_text",
                "position": {"x": 640, "y": 80},
                "data": {
                    "text": (
                        "Oi {{contact.name|default:'amigo'}}! Vi que você ficou pensando — "
                        "que tal um desconto especial? Use o cupom *VOLTA10* e ganha 10% off. "
                        "Vale só até amanhã! 🎁"
                    )
                },
            },
            {
                "id": "n_wait2",
                "type": "wait",
                "position": {"x": 920, "y": 80},
                "data": {"duration_seconds": 86400},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 1200, "y": 80},
                "data": {"condition": "{{vars.comprou|default:'nao'}} equals 'sim'"},
            },
            {
                "id": "n_thanks",
                "type": "send_text",
                "position": {"x": 1480, "y": 30},
                "data": {"text": "Obrigado pela compra! Qualquer coisa, é só chamar. 💙"},
            },
            {
                "id": "n_handoff",
                "type": "handoff_human",
                "position": {"x": 1480, "y": 180},
                "data": {
                    "queue": "vendas",
                    "msg": "Vou pedir pra alguém da equipe te chamar — pode te ajudar a fechar melhor.",
                    "pause_minutes": 120,
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_wait1"},
            {"id": "e2", "source": "n_wait1", "target": "n_cupom"},
            {"id": "e3", "source": "n_cupom", "target": "n_wait2"},
            {"id": "e4", "source": "n_wait2", "target": "n_branch"},
            {"id": "e5", "source": "n_branch", "sourceHandle": "true", "target": "n_thanks"},
            {"id": "e6", "source": "n_branch", "sourceHandle": "false", "target": "n_handoff"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 3. Qualificação SDR (BANT)
#    Trigger "quero comprar" → LLM pergunta orçamento → set_var → LLM pergunta autoridade → branch → tier_pay ou handoff
# ──────────────────────────────────────────────────────────────
QUALIFICACAO_SDR = PlaybookTemplate(
    key="qualificacao_sdr",
    nome="Qualificação SDR (BANT)",
    descricao="Qualifica lead com Budget/Authority/Need/Timeline. Se qualificou, gera Pix; senão escala pro humano.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_keyword",
                "position": {"x": 80, "y": 80},
                "data": {
                    "patterns": ["quero comprar", "tenho interesse", "fechar"],
                    "match": "any",
                },
            },
            {
                "id": "n_boas_vindas",
                "type": "send_text",
                "position": {"x": 360, "y": 80},
                "data": {
                    "text": (
                        "Que ótimo, {{contact.name|default:'amigo'}}! Pra te ajudar a fechar "
                        "rapidinho, posso fazer 2 perguntas?"
                    )
                },
            },
            {
                "id": "n_pergunta_budget",
                "type": "send_text",
                "position": {"x": 640, "y": 80},
                "data": {
                    "text": "1) Qual o investimento que você tem em mente pra esse projeto?"
                },
            },
            {
                "id": "n_wait_budget",
                "type": "wait",
                "position": {"x": 920, "y": 80},
                "data": {"duration_seconds": 180},
            },
            {
                "id": "n_save_budget",
                "type": "set_var",
                "position": {"x": 1200, "y": 80},
                "data": {"key": "budget", "value": "{{message.text}}"},
            },
            {
                "id": "n_pergunta_authority",
                "type": "send_text",
                "position": {"x": 1480, "y": 80},
                "data": {
                    "text": "2) Você é quem decide a compra ou precisa alinhar com mais alguém?"
                },
            },
            {
                "id": "n_wait_authority",
                "type": "wait",
                "position": {"x": 1760, "y": 80},
                "data": {"duration_seconds": 180},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 2040, "y": 80},
                "data": {
                    "condition": "{{message.text|lower}} contains 'eu decido'"
                },
            },
            {
                "id": "n_pix",
                "type": "tier_pay",
                "position": {"x": 2320, "y": 30},
                "data": {
                    "valor_cents": 19900,
                    "descricao": "Pedido qualificado SDR — {{contact.name}}",
                    "metodo": "pix",
                    "save_as": "payment_link",
                },
            },
            {
                "id": "n_send_pix",
                "type": "send_text",
                "position": {"x": 2600, "y": 30},
                "data": {
                    "text": "Perfeito! Te mandei o link de pagamento aqui: {{vars.payment_link}}"
                },
            },
            {
                "id": "n_handoff",
                "type": "handoff_human",
                "position": {"x": 2320, "y": 180},
                "data": {
                    "queue": "vendas",
                    "msg": "Vou passar pra alguém da equipe que pode falar direto com quem decide, ok?",
                    "pause_minutes": 240,
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_boas_vindas"},
            {"id": "e2", "source": "n_boas_vindas", "target": "n_pergunta_budget"},
            {"id": "e3", "source": "n_pergunta_budget", "target": "n_wait_budget"},
            {"id": "e4", "source": "n_wait_budget", "target": "n_save_budget"},
            {"id": "e5", "source": "n_save_budget", "target": "n_pergunta_authority"},
            {"id": "e6", "source": "n_pergunta_authority", "target": "n_wait_authority"},
            {"id": "e7", "source": "n_wait_authority", "target": "n_branch"},
            {"id": "e8", "source": "n_branch", "sourceHandle": "true", "target": "n_pix"},
            {"id": "e9", "source": "n_pix", "target": "n_send_pix"},
            {"id": "e10", "source": "n_branch", "sourceHandle": "false", "target": "n_handoff"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 4. NPS pós-compra (cron 7d após entrega → pergunta nota → branch)
# ──────────────────────────────────────────────────────────────
NPS_POS_COMPRA = PlaybookTemplate(
    key="nps_pos_compra",
    nome="NPS pós-compra",
    descricao="7 dias após entrega: pergunta nota 0-10. Promotor pede review, detrator escala humano.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_event",
                "position": {"x": 80, "y": 100},
                "data": {"event_key": "pedido_entregue"},
            },
            {
                "id": "n_wait",
                "type": "wait",
                "position": {"x": 360, "y": 100},
                "data": {"duration_seconds": 7 * 86400},
            },
            {
                "id": "n_pergunta",
                "type": "send_text",
                "position": {"x": 640, "y": 100},
                "data": {
                    "text": (
                        "Oi {{contact.name|default:'amigo'}}! Faz uma semana que recebeu seu pedido. "
                        "De 0 a 10, quanto recomendaria a gente pra alguém? Manda só o número 🙏"
                    )
                },
            },
            {
                "id": "n_wait_resposta",
                "type": "wait",
                "position": {"x": 920, "y": 100},
                "data": {"duration_seconds": 300},
            },
            {
                "id": "n_save_nota",
                "type": "set_var",
                "position": {"x": 1200, "y": 100},
                "data": {"key": "nps_nota", "value": "{{message.text|trim}}"},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 1480, "y": 100},
                "data": {"condition": "{{vars.nps_nota}} >= 9"},
            },
            {
                "id": "n_promotor",
                "type": "send_text",
                "position": {"x": 1760, "y": 30},
                "data": {
                    "text": "Que demais! 🙌 Posso te pedir uma avaliação no Google? https://g.page/r/SEU_LINK/review"
                },
            },
            {
                "id": "n_handoff",
                "type": "handoff_human",
                "position": {"x": 1760, "y": 180},
                "data": {
                    "queue": "qualidade",
                    "msg": "Vou pedir pra alguém da equipe te chamar pra entender o que dá pra melhorar.",
                    "pause_minutes": 240,
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_wait"},
            {"id": "e2", "source": "n_wait", "target": "n_pergunta"},
            {"id": "e3", "source": "n_pergunta", "target": "n_wait_resposta"},
            {"id": "e4", "source": "n_wait_resposta", "target": "n_save_nota"},
            {"id": "e5", "source": "n_save_nota", "target": "n_branch"},
            {"id": "e6", "source": "n_branch", "sourceHandle": "true", "target": "n_promotor"},
            {"id": "e7", "source": "n_branch", "sourceHandle": "false", "target": "n_handoff"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 5. Reativação cliente inativo 90d (cron → desconto Pix)
# ──────────────────────────────────────────────────────────────
REATIVACAO_INATIVO = PlaybookTemplate(
    key="reativacao_inativo",
    nome="Reativação cliente inativo",
    descricao="Cron diário 9h: clientes sem compra há 90d recebem cupom personalizado via Pix Tier Pay.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_cron",
                "position": {"x": 80, "y": 100},
                "data": {"cron_expr": "0 9 * * *", "audience": "inativos_90d"},
            },
            {
                "id": "n_llm",
                "type": "llm_step",
                "position": {"x": 360, "y": 100},
                "data": {
                    "system_prompt": (
                        "Você é vendedor amigável escrevendo mensagem de reativação. "
                        "Use tom carinhoso, lembra que sentiu falta, oferece cupom 15% off."
                    ),
                    "user_prompt": "Cliente: {{contact.name}}. Última compra: há 90+ dias.",
                    "send_text": True,
                    "save_as": "msg_reativacao",
                },
            },
            {
                "id": "n_wait",
                "type": "wait",
                "position": {"x": 640, "y": 100},
                "data": {"duration_seconds": 24 * 3600},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 920, "y": 100},
                "data": {"condition": "{{message.text|lower}} contains 'quero'"},
            },
            {
                "id": "n_pix",
                "type": "tier_pay",
                "position": {"x": 1200, "y": 30},
                "data": {
                    "valor_cents": 8500,
                    "descricao": "Compra reativação {{contact.name}} (15% off)",
                    "metodo": "pix",
                    "save_as": "pix_url",
                },
            },
            {
                "id": "n_send_pix",
                "type": "send_text",
                "position": {"x": 1480, "y": 30},
                "data": {
                    "text": "Show! Aqui o Pix com 15% off: {{vars.pix_url}}"
                },
            },
            {
                "id": "n_fim",
                "type": "send_text",
                "position": {"x": 1200, "y": 180},
                "data": {"text": "Tudo bem! Tá sempre aqui se mudar de ideia 💙"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_llm"},
            {"id": "e2", "source": "n_llm", "target": "n_wait"},
            {"id": "e3", "source": "n_wait", "target": "n_branch"},
            {"id": "e4", "source": "n_branch", "sourceHandle": "true", "target": "n_pix"},
            {"id": "e5", "source": "n_pix", "target": "n_send_pix"},
            {"id": "e6", "source": "n_branch", "sourceHandle": "false", "target": "n_fim"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 6. Triagem Suporte L1 + escalation L2 (RAG knowledge → branch resolvido → handoff)
# ──────────────────────────────────────────────────────────────
TRIAGEM_SUPORTE = PlaybookTemplate(
    key="triagem_suporte",
    nome="Triagem Suporte L1 + L2",
    descricao="Agente busca knowledge real (RAG pgvector + cita fonte). Resolveu? fim. Senão escala L2.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_keyword",
                "position": {"x": 80, "y": 100},
                "data": {
                    "patterns": ["ajuda", "como faço", "problema", "não funciona", "dúvida"],
                    "match": "any",
                },
            },
            {
                "id": "n_kb",
                "type": "knowledge_lookup",
                "position": {"x": 360, "y": 100},
                "data": {
                    "query": "{{message.text}}",
                    "top_k": 3,
                    "save_as": "kb_result",
                    "save_sources_as": "kb_sources",
                    "synthesize": True,
                    "send_text": True,
                },
            },
            {
                "id": "n_pergunta",
                "type": "send_text",
                "position": {"x": 640, "y": 100},
                "data": {"text": "Isso resolveu? Responde *sim* ou *não*."},
            },
            {
                "id": "n_wait",
                "type": "wait",
                "position": {"x": 920, "y": 100},
                "data": {"duration_seconds": 120},
            },
            {
                "id": "n_branch",
                "type": "branch",
                "position": {"x": 1200, "y": 100},
                "data": {"condition": "{{message.text|lower}} contains 'não'"},
            },
            {
                "id": "n_handoff",
                "type": "handoff_human",
                "position": {"x": 1480, "y": 30},
                "data": {
                    "queue": "suporte_l2",
                    "msg": "Vou chamar alguém da equipe técnica pra te ajudar melhor.",
                    "pause_minutes": 120,
                },
            },
            {
                "id": "n_fim",
                "type": "send_text",
                "position": {"x": 1480, "y": 180},
                "data": {"text": "Show! Qualquer outra dúvida, é só chamar. 😊"},
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_kb"},
            {"id": "e2", "source": "n_kb", "target": "n_pergunta"},
            {"id": "e3", "source": "n_pergunta", "target": "n_wait"},
            {"id": "e4", "source": "n_wait", "target": "n_branch"},
            {"id": "e5", "source": "n_branch", "sourceHandle": "true", "target": "n_handoff"},
            {"id": "e6", "source": "n_branch", "sourceHandle": "false", "target": "n_fim"},
        ],
    },
)


# ──────────────────────────────────────────────────────────────
# 7. Atendente Multi-especialista (route_to_specialist)
# ──────────────────────────────────────────────────────────────
EQUIPE_MULTI_ESPECIALISTA = PlaybookTemplate(
    key="equipe_multi_especialista",
    nome="Equipe IA Multi-Especialista",
    descricao="Router classifica intent e direciona pra vendedor / suporte / financeiro / agendamento.",
    canvas_json={
        "version": 1,
        "nodes": [
            {
                "id": "n_trigger",
                "type": "trigger_keyword",
                "position": {"x": 80, "y": 100},
                "data": {"patterns": ["oi", "olá", "ola", "bom dia", "boa tarde"], "match": "any"},
            },
            {
                "id": "n_router",
                "type": "route_to_specialist",
                "position": {"x": 380, "y": 100},
                "data": {
                    "specialists": [
                        {
                            "name": "vendas",
                            "description": "Cliente quer comprar, orçamento, ver preço, fechar pedido",
                            "system_prompt": "Você é vendedor experiente focado em fechar venda. Use técnicas SPIN simples (Situação, Problema, Implicação, Necessidade). Ofereça Pix com 5% off se cliente hesitar.",
                            "auto_reply": True,
                        },
                        {
                            "name": "suporte",
                            "description": "Cliente tem dúvida, problema, defeito, pediu ajuda técnica",
                            "system_prompt": "Você é suporte L1. Responda com clareza, ofereça passo-a-passo numerado. Se não souber, peça pra detalhar o erro.",
                            "auto_reply": True,
                        },
                        {
                            "name": "financeiro",
                            "description": "Cliente perguntou fatura, boleto, 2ª via, pagamento, parcelamento",
                            "system_prompt": "Você é financeiro objetivo. Explique condições, ofereça parcelar até 3x sem juros, ou Pix com 5% off à vista.",
                            "auto_reply": True,
                        },
                    ],
                    "default_specialist": "suporte",
                    "save_as": "specialist",
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_trigger", "target": "n_router"},
        ],
    },
)


TEMPLATES: dict[str, PlaybookTemplate] = {
    FAQ_HANDOFF.key: FAQ_HANDOFF,
    RECUPERAR_CARRINHO.key: RECUPERAR_CARRINHO,
    QUALIFICACAO_SDR.key: QUALIFICACAO_SDR,
    NPS_POS_COMPRA.key: NPS_POS_COMPRA,
    REATIVACAO_INATIVO.key: REATIVACAO_INATIVO,
    TRIAGEM_SUPORTE.key: TRIAGEM_SUPORTE,
    EQUIPE_MULTI_ESPECIALISTA.key: EQUIPE_MULTI_ESPECIALISTA,
}


def get_template(key: str) -> PlaybookTemplate | None:
    return TEMPLATES.get(key)


def list_templates() -> list[dict]:
    return [
        {"key": t.key, "nome": t.nome, "descricao": t.descricao, "nodes_count": len(t.canvas_json.get("nodes") or [])}
        for t in TEMPLATES.values()
    ]
