"""CodeAct — agente escreve Python e roda em sandbox E2B managed.

E2B = Firecracker microVMs isoladas. Cliente roda código sem risco de RCE no
host. Default whitelist: pandas, requests (sem auth), numpy, dateutil.

E2B_API_KEY env var. Sem key, retorna error (sem fallback inseguro).

Docs: https://e2b.dev/docs
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

E2B_BASE = "https://api.e2b.dev/v1"


@dataclass
class CodeExecResult:
    ok: bool
    stdout: str = ""
    stderr: str = ""
    result: str = ""  # último valor da expressão
    error: str | None = None
    execution_time_ms: int = 0


async def execute_python(
    code: str,
    *,
    timeout_s: int = 30,
    template: str = "base",
) -> CodeExecResult:
    """Executa snippet Python no E2B sandbox.

    Usa endpoint sandbox short-lived (não persiste estado entre calls).
    Pra workflows multi-step usar sandbox session (V2).
    """
    api_key = os.environ.get("E2B_API_KEY")
    if not api_key:
        return CodeExecResult(ok=False, error="E2B_API_KEY ausente — CodeAct desabilitado")
    if not code or not code.strip():
        return CodeExecResult(ok=False, error="code vazio")

    headers = {
        "X-API-Key": api_key,
        "Content-Type": "application/json",
    }

    # 1) Cria sandbox
    try:
        async with httpx.AsyncClient(timeout=timeout_s + 5) as cli:
            sb_resp = await cli.post(
                f"{E2B_BASE}/sandboxes",
                json={"templateID": template, "timeoutMs": timeout_s * 1000},
                headers=headers,
            )
            if sb_resp.status_code >= 400:
                return CodeExecResult(
                    ok=False,
                    error=f"E2B create sandbox HTTP {sb_resp.status_code}: {sb_resp.text[:200]}",
                )
            sb_data = sb_resp.json()
            sb_id = sb_data.get("sandboxID") or sb_data.get("id")

            # 2) Executa código
            exec_resp = await cli.post(
                f"{E2B_BASE}/sandboxes/{sb_id}/code",
                json={"code": code, "language": "python"},
                headers=headers,
            )
            if exec_resp.status_code >= 400:
                return CodeExecResult(
                    ok=False,
                    error=f"E2B exec HTTP {exec_resp.status_code}: {exec_resp.text[:200]}",
                )
            exec_data = exec_resp.json()

            # 3) Cleanup (best-effort)
            try:
                await cli.delete(f"{E2B_BASE}/sandboxes/{sb_id}", headers=headers)
            except Exception:
                pass

    except Exception as e:
        return CodeExecResult(ok=False, error=f"E2B conn: {e}")

    stdout = (exec_data.get("stdout") or "").strip()
    stderr = (exec_data.get("stderr") or "").strip()
    result = (exec_data.get("result") or "").strip() if isinstance(exec_data.get("result"), str) else str(exec_data.get("result") or "")
    err = exec_data.get("error")

    return CodeExecResult(
        ok=not err,
        stdout=stdout[:4000],
        stderr=stderr[:2000],
        result=result[:4000],
        error=str(err)[:500] if err else None,
        execution_time_ms=int(exec_data.get("executionTimeMs", 0)),
    )
