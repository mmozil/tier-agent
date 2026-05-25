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
    def __init__(self, user_id: int, email: str, tenant_id: int | None = None, is_admin: bool = False):
        self.user_id = user_id
        self.email = email
        self.tenant_id = tenant_id
        self.is_admin = is_admin


async def get_current_user(
    authorization: str | None = Header(default=None),
    tier_session: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """Lê JWT do Authorization header OU do cookie SSO Tier."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    elif tier_session:
        token = tier_session

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")

    payload = decode_token(token)
    return CurrentUser(
        user_id=int(payload["sub"]),
        email=payload.get("email", ""),
        tenant_id=payload.get("tenant_id"),
        is_admin=bool(payload.get("is_admin", False)),
    )


async def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas admin Tier")
    return user
