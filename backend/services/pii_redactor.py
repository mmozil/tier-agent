"""PII redactor BR-first — substitui CPF/CNPJ/cartão/email/telefone/RG por placeholders
estáveis antes de mandar pro LLM, e reverte na resposta.

Por que regex em vez de Presidio:
- Dependência leve (zero infra extra). Presidio puxa spaCy+torch ~500MB
- 100% pt-BR (CPF/CNPJ/CEP/IE BR não estão bem cobertos no Presidio default)
- Stable placeholders permitem reversal trivial após resposta do LLM

Uso:
    redactor = PiiRedactor()
    masked, mapping = redactor.redact("CPF do cliente é 123.456.789-00")
    # masked = "CPF do cliente é {CPF_1}"
    response = await llm.send(masked)
    final = redactor.restore(response.text, mapping)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Pattern


@dataclass
class PiiMapping:
    """Mapa de placeholder → valor original pra reversal."""
    items: dict[str, str] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.items)


# ────────────────────────────────────────────────────────────
# Regex BR-focused
# ────────────────────────────────────────────────────────────

# CPF: 000.000.000-00 ou 00000000000 (11 dígitos)
_CPF = re.compile(r"\b(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})\b")

# CNPJ: 00.000.000/0000-00 ou 00000000000000 (14 dígitos)
_CNPJ = re.compile(r"\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2})\b")

# Cartão: 16 dígitos com hífens/espaços/junto (rough — não valida Luhn aqui)
_CARTAO = re.compile(r"\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b")

# Email
_EMAIL = re.compile(r"\b([\w._%+-]+@[\w.-]+\.[A-Za-z]{2,})\b")

# Telefone BR: (XX) 9XXXX-XXXX ou 11 dígitos puros começando com DDD válido
# Aceita +55 prefix opcional + DDD 11-99 + 9 + 8 dígitos (celular)
_TELEFONE = re.compile(
    r"\b(?:\+?55\s?)?(?:\(?(?:1[1-9]|2[1-9]|3[1-9]|4[1-9]|5[1-9]|6[1-9]|7[1-9]|8[1-9]|9[1-9])\)?\s?)?9?\d{4}[-.\s]?\d{4}\b"
)

# RG: variadas máscaras estado-dependente — pega só padrão SP "00.000.000-X"
_RG = re.compile(r"\b(\d{2}[.\s]\d{3}[.\s]\d{3}[-\s]?[\dXx])\b")

# CEP: 00000-000
_CEP = re.compile(r"\b(\d{5}[-\s]?\d{3})\b")


@dataclass
class _RuleSpec:
    name: str
    pattern: Pattern[str]
    enabled: bool = True


_RULES: list[_RuleSpec] = [
    _RuleSpec("CARTAO", _CARTAO),  # mais específico primeiro pra evitar conflict com CPF/CNPJ
    _RuleSpec("CNPJ", _CNPJ),
    _RuleSpec("CPF", _CPF),
    _RuleSpec("RG", _RG),
    _RuleSpec("CEP", _CEP),
    _RuleSpec("EMAIL", _EMAIL),
    _RuleSpec("TELEFONE", _TELEFONE),
]


class PiiRedactor:
    """Substitui PII por placeholders e permite reversão depois.

    Stateless — pode reusar uma instância pra múltiplas calls (mapping é externo).
    Cada placeholder tem id incremental por tipo: {CPF_1}, {CPF_2}, etc.
    Se o mesmo valor PII aparece N vezes, gera o MESMO placeholder (dedup).
    """

    def __init__(self, rules: list[_RuleSpec] | None = None):
        self._rules = rules or _RULES

    def redact(self, text: str) -> tuple[str, PiiMapping]:
        """Retorna (texto_redactado, mapping)."""
        if not text:
            return text, PiiMapping()

        mapping = PiiMapping()
        reverse: dict[str, str] = {}  # valor_original → placeholder (dedup)
        counters: dict[str, int] = {r.name: 0 for r in self._rules}

        out = text
        for rule in self._rules:
            if not rule.enabled:
                continue

            def _replace(m: re.Match[str], _rule=rule) -> str:
                original = m.group(0).strip()
                if original in reverse:
                    return reverse[original]
                counters[_rule.name] += 1
                placeholder = f"{{{_rule.name}_{counters[_rule.name]}}}"
                mapping.items[placeholder] = original
                reverse[original] = placeholder
                return placeholder

            out = rule.pattern.sub(_replace, out)

        return out, mapping

    def restore(self, text: str, mapping: PiiMapping) -> str:
        """Volta os placeholders pros valores originais.

        Não-destrutivo: se LLM omitiu placeholder na resposta, fica omitido (ok).
        """
        if not text or not mapping:
            return text
        out = text
        for placeholder, original in mapping.items.items():
            out = out.replace(placeholder, original)
        return out


# Singleton de conveniência
_default = PiiRedactor()


def redact(text: str) -> tuple[str, PiiMapping]:
    return _default.redact(text)


def restore(text: str, mapping: PiiMapping) -> str:
    return _default.restore(text, mapping)
