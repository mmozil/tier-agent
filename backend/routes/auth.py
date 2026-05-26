"""Auth — signup + login + Google OAuth. MVP: 1 user por tenant (email = login)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_token
from core.config import get_settings
from core.db import get_db
from models import TaTenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()


class SignupIn(BaseModel):
    nome_pessoa: str  # nome do user
    nome: str  # nome da empresa
    email: EmailStr
    password: str
    cnpj: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: int
    email: str
    is_admin: bool


async def _find_tenant(db: AsyncSession, email: str) -> TaTenant | None:
    result = await db.execute(select(TaTenant).where(TaTenant.email == email))
    return result.scalar_one_or_none()


def _set_cookie(response: Response, token: str) -> None:
    """Set tier_session cookie cross-subdomain pra SSO."""
    response.set_cookie(
        key=settings.tier_sso_cookie_name,
        value=token,
        max_age=settings.jwt_ttl_hours * 3600,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        domain=settings.tier_sso_cookie_domain if settings.is_production else None,
        path="/",
    )


@router.post("/signup", response_model=AuthOut, status_code=201)
async def signup(payload: SignupIn, response: Response, db: AsyncSession = Depends(get_db)):
    existing = await _find_tenant(db, payload.email)
    if existing:
        raise HTTPException(400, "E-mail já cadastrado")

    if len(payload.password) < 8:
        raise HTTPException(400, "Senha precisa de pelo menos 8 caracteres")

    tenant = TaTenant(
        nome=payload.nome,
        nome_pessoa=payload.nome_pessoa,
        email=payload.email,
        cnpj=payload.cnpj,
        password_hash=pwd_ctx.hash(payload.password),
        sku="trial",
        status="active",
    )
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)

    token = create_token(
        subject=str(tenant.id),
        extra_claims={"email": tenant.email, "tenant_id": tenant.id, "is_admin": tenant.is_admin},
    )
    _set_cookie(response, token)
    return AuthOut(
        access_token=token, tenant_id=tenant.id, email=tenant.email, is_admin=tenant.is_admin
    )


@router.post("/login", response_model=AuthOut)
async def login(payload: LoginIn, response: Response, db: AsyncSession = Depends(get_db)):
    tenant = await _find_tenant(db, payload.email)
    if not tenant or not tenant.password_hash:
        raise HTTPException(401, "Credenciais inválidas")
    if not pwd_ctx.verify(payload.password, tenant.password_hash):
        raise HTTPException(401, "Credenciais inválidas")

    token = create_token(
        subject=str(tenant.id),
        extra_claims={"email": tenant.email, "tenant_id": tenant.id, "is_admin": tenant.is_admin},
    )
    _set_cookie(response, token)
    return AuthOut(
        access_token=token, tenant_id=tenant.id, email=tenant.email, is_admin=tenant.is_admin
    )


class GoogleLoginIn(BaseModel):
    credential: str  # ID token from Google Identity Services


@router.post("/google", response_model=AuthOut)
async def google_login(
    payload: GoogleLoginIn, response: Response, db: AsyncSession = Depends(get_db)
):
    """Login via Google OAuth — valida ID token + cria tenant se não existe."""
    if not settings.google_client_id:
        raise HTTPException(500, "Google OAuth não configurado")

    try:
        idinfo = google_id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=10,
        )
    except ValueError as e:
        logger.warning("Google ID token inválido: %s", e)
        raise HTTPException(401, "Token Google inválido")

    email = idinfo.get("email")
    if not email or not idinfo.get("email_verified"):
        raise HTTPException(401, "Email não verificado pelo Google")

    nome_pessoa = idinfo.get("name") or email.split("@")[0]

    tenant = await _find_tenant(db, email)
    if not tenant:
        # Auto-cria tenant no primeiro login Google
        tenant = TaTenant(
            nome=nome_pessoa,  # usa nome pessoa como label de tenant por padrão
            nome_pessoa=nome_pessoa,
            email=email,
            sku="trial",
            status="active",
        )
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)
        logger.info("Tenant criado via Google login: %s id=%s", email, tenant.id)

    token = create_token(
        subject=str(tenant.id),
        extra_claims={"email": tenant.email, "tenant_id": tenant.id, "is_admin": tenant.is_admin},
    )
    _set_cookie(response, token)
    return AuthOut(
        access_token=token, tenant_id=tenant.id, email=tenant.email, is_admin=tenant.is_admin
    )


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(
        key=settings.tier_sso_cookie_name,
        domain=settings.tier_sso_cookie_domain if settings.is_production else None,
        path="/",
    )
    return {"status": "logged_out"}


@router.get("/me")
async def me(db: AsyncSession = Depends(get_db), user=Depends(__import__("core.auth", fromlist=["get_current_user"]).get_current_user)):
    tenant = await db.get(TaTenant, user.tenant_id) if user.tenant_id else None
    return {
        "user_id": user.user_id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "is_admin": user.is_admin,
        "tenant": {
            "id": tenant.id,
            "nome": tenant.nome,
            "nome_pessoa": tenant.nome_pessoa,
            "sku": tenant.sku,
            "status": tenant.status,
        } if tenant else None,
    }
