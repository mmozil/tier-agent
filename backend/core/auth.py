"""Auth — JWT próprio + suporte ao cookie SSO Tier."""

from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, Header, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.db import get_db

settings = get_settings()


def create_token(subject: str, extra_claims: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_ttl_hours)).timestamp()),
        **(extra_claims or {}),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Token inválido: {e}") from e


class CurrentUser:
    def __init__(
        self,
        user_id: int,
        email: str,
        tenant_id: int | None = None,
        is_admin: bool = False,
        member_id: int | None = None,
        member_name: str | None = None,
        role: str = "owner",
    ):
        self.user_id = user_id
        self.email = email
        self.tenant_id = tenant_id
        self.is_admin = is_admin
        # Multi-usuário: member_id None = dono (TaTenant). role: owner|admin|atendente
        self.member_id = member_id
        self.member_name = member_name
        self.role = role

    @property
    def is_owner(self) -> bool:
        return self.member_id is None


async def get_current_user(
    authorization: str | None = Header(default=None),
    ta_session: str | None = Cookie(default=None),
    tier_session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Lê JWT do Authorization header OU do cookie de sessão do Agent (ta_session).

    🚨 tier_session (cookie do ERP em .tier.finance) NÃO é mais fonte primária —
    os segredos são diferentes e o nome compartilhado causava atropelo de sessão
    entre Agent e ERP (incidente 17/08/2026). Ele fica só como fallback de
    transição: se contém um token NOSSO válido (sessão antiga do Agent), ainda
    autentica até expirar; token do ERP falha a assinatura e é ignorado.
    """
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    elif ta_session:
        token = ta_session
    elif tier_session:
        try:
            jwt.decode(tier_session, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
            token = tier_session  # sessão legada do Agent — aceita até o vencimento
        except JWTError:
            token = None  # token do ERP no cookie compartilhado — não é nosso

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")

    payload = decode_token(token)
    return CurrentUser(
        user_id=int(payload["sub"]),
        email=payload.get("email", ""),
        tenant_id=payload.get("tenant_id"),
        is_admin=bool(payload.get("is_admin", False)),
        member_id=payload.get("member_id"),
        member_name=payload.get("member_name"),
        role=payload.get("role", "owner"),
    )


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas admin Tier")
    return user
