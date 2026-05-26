"""Template engine simples para playbooks — `{{var}}` + filtros.

Sintaxe suportada:
    {{contact.name}}
    {{message.text}}
    {{vars.pedido_id}}
    {{conversation.msg_count}}
    {{agent.nome}} / {{tenant.nome}}

Filtros encadeáveis (pipe):
    {{message.text|lower}}
    {{contact.name|default:'amigo'}}
    {{vars.valor|trim|upper}}

Não usa Jinja: surface mínima, render-só-string, seguro contra code injection.
"""

from __future__ import annotations

import re
from typing import Any

# Captura: {{ path[|filter1[:arg1]][|filter2[:arg2]] }}
# path = letras/digitos/_/./[/]
_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.\[\]]+(?:\s*\|[^}]+)?)\s*\}\}")


class TemplateRenderError(Exception):
    pass


def _deep_get(obj: Any, path: str) -> Any:
    """Resolve `a.b.c` em dict aninhado. Retorna None se path quebra."""
    if obj is None:
        return None
    cur: Any = obj
    for key in path.split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(key)
        elif isinstance(cur, list):
            # suporta `a.0.b` (índice numérico em lista)
            try:
                cur = cur[int(key)]
            except (ValueError, IndexError):
                return None
        else:
            cur = getattr(cur, key, None)
    return cur


def _apply_filter(value: Any, filter_spec: str) -> Any:
    """Aplica 1 filtro: `lower`, `upper`, `trim`, `default:'X'`, `length`, `json`."""
    filter_spec = filter_spec.strip()
    if ":" in filter_spec:
        fname, arg = filter_spec.split(":", 1)
        fname = fname.strip()
        arg = arg.strip().strip("'\"")
    else:
        fname = filter_spec
        arg = None

    if fname == "lower":
        return str(value).lower() if value is not None else ""
    if fname == "upper":
        return str(value).upper() if value is not None else ""
    if fname == "trim":
        return str(value).strip() if value is not None else ""
    if fname == "length":
        try:
            return len(value)  # type: ignore[arg-type]
        except TypeError:
            return 0
    if fname == "default":
        if value is None or value == "":
            return arg if arg is not None else ""
        return value
    if fname == "json":
        import json
        try:
            return json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(value)
    # filtro desconhecido — devolve valor cru
    return value


def render_string(template: str, context: dict[str, Any]) -> str:
    """Render `template` substituindo `{{var}}` pelo lookup em `context`.

    `context` deve ter chaves de top-level esperadas: `contact`, `message`,
    `conversation`, `vars`, `agent`, `tenant`. Tudo opcional — se path não
    resolve, render vazio.
    """
    if not template or not isinstance(template, str):
        return template or ""
    if "{{" not in template:
        return template

    def replace(match: re.Match[str]) -> str:
        expr = match.group(1).strip()
        parts = [p.strip() for p in expr.split("|")]
        path = parts[0]
        filters = parts[1:]

        value: Any = _deep_get(context, path)

        for f in filters:
            value = _apply_filter(value, f)

        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            import json
            return json.dumps(value, ensure_ascii=False)
        return str(value)

    return _TEMPLATE_RE.sub(replace, template)


def render_dict(obj: Any, context: dict[str, Any]) -> Any:
    """Render recursivo em estruturas — strings em qualquer nível ganham `{{}}` resolvido.

    Útil pra renderizar `node.data` inteiro de uma vez antes de executar.
    """
    if isinstance(obj, str):
        return render_string(obj, context)
    if isinstance(obj, dict):
        return {k: render_dict(v, context) for k, v in obj.items()}
    if isinstance(obj, list):
        return [render_dict(v, context) for v in obj]
    return obj


# DSL minimal pra branch — `"{{message.text|lower}} contains 'oi'"`
_BRANCH_OP_RE = re.compile(
    r"^(.+?)\s+(contains|not contains|equals|not equals|>|<|>=|<=|matches|starts with|ends with)\s+(.+)$",
    re.IGNORECASE,
)


def evaluate_branch(condition: str, context: dict[str, Any]) -> bool:
    """Avalia expressão simples tipo `'{{var}} op valor'` → True/False.

    Operadores: contains, not contains, equals, not equals, >, <, >=, <=,
    matches (regex), starts with, ends with.
    """
    if not condition:
        return False
    rendered = render_string(condition, context)
    m = _BRANCH_OP_RE.match(rendered.strip())
    if not m:
        # condição sem operador — verdadeiro se string não-vazia/0/false
        v = rendered.strip().lower()
        return v not in ("", "0", "false", "none", "null")

    left_raw, op, right_raw = m.groups()
    left = left_raw.strip().strip("'\"")
    right = right_raw.strip().strip("'\"")
    op = op.lower().strip()

    if op == "contains":
        return right in left
    if op == "not contains":
        return right not in left
    if op == "equals":
        return left == right
    if op == "not equals":
        return left != right
    if op == "starts with":
        return left.startswith(right)
    if op == "ends with":
        return left.endswith(right)
    if op == "matches":
        try:
            return bool(re.search(right, left))
        except re.error:
            return False
    if op in (">", "<", ">=", "<="):
        try:
            l_num = float(left)
            r_num = float(right)
        except ValueError:
            return False
        if op == ">":
            return l_num > r_num
        if op == "<":
            return l_num < r_num
        if op == ">=":
            return l_num >= r_num
        if op == "<=":
            return l_num <= r_num
    return False
