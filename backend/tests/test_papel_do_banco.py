"""O papel do membro sai do banco a cada requisição, não do token (30/10/2026).

O token vale 24 h. Na M7, sete pessoas deixaram de ser admin no Atendimento e seguiam vendo
as conversas de todos os vendedores até o token vencer — inclusive um consultor de fora.
"""

import asyncio
import os
from types import SimpleNamespace

# `core.auth` carrega as settings no import: valores só de teste, sem banco nem rede.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://teste:teste@localhost/teste")
os.environ.setdefault("JWT_SECRET", "segredo-so-de-teste-com-mais-de-32-caracteres")
os.environ.setdefault("FERNET_KEY", "chave-so-de-teste-com-mais-de-32-caracteres")

from core import auth  # noqa: E402


class _Db:
    def __init__(self, membro):
        self.membro = membro

    async def get(self, _modelo, _id):
        return self.membro


def _usuario(token_role, membro):
    token = auth.create_token("1", {"tenant_id": 18, "member_id": 33, "role": token_role})
    return asyncio.run(
        auth.get_current_user(authorization=f"Bearer {token}", ta_session=None, tier_session=None, db=_Db(membro))
    )


def test_token_de_admin_obedece_o_papel_atual_do_banco():
    membro = SimpleNamespace(status="active", tenant_id=18, role="atendente")
    assert _usuario("admin", membro).role == "atendente"


def test_admin_no_banco_segue_admin():
    membro = SimpleNamespace(status="active", tenant_id=18, role="admin")
    assert _usuario("atendente", membro).role == "admin"


def test_dono_sem_membro_segue_o_token():
    token = auth.create_token("1", {"tenant_id": 18, "role": "owner"})
    u = asyncio.run(auth.get_current_user(authorization=f"Bearer {token}", ta_session=None, tier_session=None, db=_Db(None)))
    assert u.role == "owner" and u.member_id is None
