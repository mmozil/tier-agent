"""Self-improving skills — lê skills auto-criadas pelo Engine Curator FSM.

Engine salva skills em `/opt/data/.engine/skills/` (ou subdirs). Skills criadas
manualmente via Tier (upload knowledge) ficam em `knowledge/`. Skills
auto-criadas pelo Curator do Engine ficam em outros subdirs (e.g. `learned/`,
`auto/`). Vamos listar TUDO em `.engine/skills/**/*.md` exceto `knowledge/`
(que é doc do cliente, não auto-aprendido).

Cada skill é arquivo markdown com YAML frontmatter:
    ---
    name: skill-name
    description: ...
    version: 1.0
    metadata:
      engine:
        created_at: ...
        tags: [...]
    ---
    # ...
"""

from __future__ import annotations

import json
import logging
import re
import shlex
from dataclasses import dataclass
from datetime import datetime

from services.container_orchestrator import _ssh_run, container_name

logger = logging.getLogger(__name__)

SKILLS_ROOT = "/opt/data/.engine/skills"
KNOWLEDGE_PREFIX = "knowledge/"  # exclui — são uploads do cliente


@dataclass
class SkillInfo:
    path: str  # path absoluto no container
    name: str  # nome do arquivo sem .md
    relative_dir: str  # subdir relativo a SKILLS_ROOT
    size_bytes: int
    modified_at: datetime | None
    title: str | None
    description: str | None
    is_user_uploaded: bool  # knowledge/* é upload manual; resto é auto


def list_skills_in_container(tenant_id: int) -> list[SkillInfo]:
    """Lista todas skills `.md` dentro do container Engine do tenant."""
    cname = container_name(tenant_id)
    # find + stat — formato saída: <path>|<size>|<mtime_epoch>
    cmd = (
        f"docker exec {shlex.quote(cname)} sh -c "
        f"{shlex.quote(f'find {SKILLS_ROOT} -type f -name \"*.md\" -exec stat -c \"%n|%s|%Y\" {{}} \\;')}"
    )
    rc, out, err = _ssh_run(cmd, timeout=15)
    if rc != 0:
        logger.warning("list_skills_in_container falhou tenant=%s: %s", tenant_id, err[:200])
        return []

    skills: list[SkillInfo] = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        path, size_str, mtime_str = parts[0], parts[1], parts[2]
        try:
            size = int(size_str)
            mtime = datetime.utcfromtimestamp(int(mtime_str))
        except Exception:
            size = 0
            mtime = None

        rel = path[len(SKILLS_ROOT) + 1 :] if path.startswith(SKILLS_ROOT) else path
        rel_dir = "/".join(rel.split("/")[:-1]) or ""
        name = rel.split("/")[-1].rsplit(".", 1)[0]
        is_user = rel.startswith(KNOWLEDGE_PREFIX)

        # Lê frontmatter pra título/descrição (preview)
        title = None
        description = None
        try:
            cat_cmd = (
                f"docker exec {shlex.quote(cname)} sh -c "
                f"{shlex.quote(f'head -c 600 {path}')}"
            )
            crc, cout, _ = _ssh_run(cat_cmd, timeout=10)
            if crc == 0 and cout:
                title, description = _parse_frontmatter(cout)
        except Exception:
            pass

        skills.append(
            SkillInfo(
                path=path,
                name=name,
                relative_dir=rel_dir,
                size_bytes=size,
                modified_at=mtime,
                title=title,
                description=description,
                is_user_uploaded=is_user,
            )
        )

    return skills


def _parse_frontmatter(text: str) -> tuple[str | None, str | None]:
    """Extrai name + description do YAML frontmatter (best-effort regex)."""
    m = re.search(r"name:\s*(.+)", text)
    name = m.group(1).strip().strip('"').strip("'") if m else None
    m = re.search(r"description:\s*(.+)", text)
    desc = m.group(1).strip().strip('"').strip("'") if m else None
    return name, desc


def archive_skill_in_container(tenant_id: int, skill_path: str) -> bool:
    """Move skill pra `.engine/skills_archive/` (não deleta — permite restore)."""
    cname = container_name(tenant_id)
    archive_dir = f"{SKILLS_ROOT}_archive"
    filename = skill_path.rsplit("/", 1)[-1]
    target = f"{archive_dir}/{filename}"
    cmd = (
        f"docker exec {shlex.quote(cname)} sh -c "
        f"{shlex.quote(f'mkdir -p {archive_dir} && mv {skill_path} {target}')}"
    )
    rc, _, err = _ssh_run(cmd, timeout=15)
    if rc != 0:
        logger.warning("archive_skill falhou tenant=%s skill=%s: %s", tenant_id, skill_path, err[:200])
        return False
    return True


def read_skill_content(tenant_id: int, skill_path: str) -> str | None:
    """Lê conteúdo full da skill (até 50KB)."""
    cname = container_name(tenant_id)
    cmd = f"docker exec {shlex.quote(cname)} sh -c {shlex.quote(f'head -c 51200 {skill_path}')}"
    rc, out, _ = _ssh_run(cmd, timeout=15)
    return out if rc == 0 else None
