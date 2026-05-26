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


TEMPLATES: dict[str, PlaybookTemplate] = {
    FAQ_HANDOFF.key: FAQ_HANDOFF,
    RECUPERAR_CARRINHO.key: RECUPERAR_CARRINHO,
    QUALIFICACAO_SDR.key: QUALIFICACAO_SDR,
}


def get_template(key: str) -> PlaybookTemplate | None:
    return TEMPLATES.get(key)


def list_templates() -> list[dict]:
    return [
        {"key": t.key, "nome": t.nome, "descricao": t.descricao, "nodes_count": len(t.canvas_json.get("nodes") or [])}
        for t in TEMPLATES.values()
    ]
