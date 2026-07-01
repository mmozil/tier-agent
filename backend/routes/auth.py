"""Auth — signup + login + Google OAuth. MVP: 1 user por tenant (email = login)."""

import logging

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_token
from core.config import get_settings
from core.db import get_db
from models import TaMember, TaTenant
from services.storage_service import storage

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
    role: str = "owner"
    member_id: int | None = None
    member_name: str | None = None


async def _find_tenant(db: AsyncSession, email: str) -> TaTenant | None:
    result = await db.execute(select(TaTenant).where(TaTenant.email == email))
    return result.scalar_one_or_none()


async def _find_member(db: AsyncSession, email: str) -> TaMember | None:
    result = await db.execute(select(TaMember).where(TaMember.email == email))
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
    # 1) dono (TaTenant) — login original, inalterado
    tenant = await _find_tenant(db, payload.email)
    if tenant:
        if not tenant.password_hash or not pwd_ctx.verify(payload.password, tenant.password_hash):
            raise HTTPException(401, "Credenciais inválidas")
        token = create_token(
            subject=str(tenant.id),
            extra_claims={
                "email": tenant.email, "tenant_id": tenant.id,
                "is_admin": tenant.is_admin, "role": "owner",
            },
        )
        _set_cookie(response, token)
        return AuthOut(
            access_token=token, tenant_id=tenant.id, email=tenant.email,
            is_admin=tenant.is_admin, role="owner",
        )

    # 2) atendente (TaMember) — login multi-usuário
    member = await _find_member(db, payload.email)
    if (
        not member
        or member.status != "active"
        or not member.password_hash
        or not pwd_ctx.verify(payload.password, member.password_hash)
    ):
        raise HTTPException(401, "Credenciais inválidas")
    token = create_token(
        subject=str(member.tenant_id),
        extra_claims={
            "email": member.email, "tenant_id": member.tenant_id, "is_admin": False,
            "member_id": member.id, "member_name": member.nome, "role": member.role,
        },
    )
    _set_cookie(response, token)
    return AuthOut(
        access_token=token, tenant_id=member.tenant_id, email=member.email,
        is_admin=False, role=member.role, member_id=member.id, member_name=member.nome,
    )


class GoogleLoginIn(BaseModel):
    credential: str | None = None  # ID token (GIS widget legacy)
    access_token: str | None = None  # OAuth2 access token (useGoogleLogin popup)


@router.post("/google", response_model=AuthOut)
async def google_login(
    payload: GoogleLoginIn, response: Response, db: AsyncSession = Depends(get_db)
):
    """Login via Google OAuth — aceita credential (ID token GIS) OU access_token (popup)."""
    if not settings.google_client_id:
        raise HTTPException(500, "Google OAuth não configurado")

    email: str | None = None
    nome_pessoa: str | None = None

    if payload.access_token:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {payload.access_token}"},
            )
            if r.status_code != 200:
                logger.warning("Google userinfo falhou: %s %s", r.status_code, r.text[:200])
                raise HTTPException(401, "Token Google inválido")
            info = r.json()
            if not info.get("email_verified"):
                raise HTTPException(401, "Email não verificado pelo Google")
            email = info.get("email")
            nome_pessoa = info.get("name") or (email.split("@")[0] if email else None)
    elif payload.credential:
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
        if not idinfo.get("email_verified"):
            raise HTTPException(401, "Email não verificado pelo Google")
        email = idinfo.get("email")
        nome_pessoa = idinfo.get("name") or (email.split("@")[0] if email else None)
    else:
        raise HTTPException(400, "Informe access_token ou credential")

    if not email:
        raise HTTPException(401, "Email não retornado pelo Google")

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
            "avatar_url": tenant.avatar_url,
            "sku": tenant.sku,
            "status": tenant.status,
        } if tenant else None,
    }


class UpdateMeIn(BaseModel):
    nome_pessoa: str | None = None
    nome: str | None = None


@router.patch("/me")
async def update_me(
    payload: UpdateMeIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(__import__("core.auth", fromlist=["get_current_user"]).get_current_user),
):
    if not user.tenant_id:
        raise HTTPException(404, "Tenant não encontrado")
    tenant = await db.get(TaTenant, user.tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant não encontrado")
    if payload.nome_pessoa is not None:
        tenant.nome_pessoa = payload.nome_pessoa.strip() or None
    if payload.nome is not None:
        nome_limpo = payload.nome.strip()
        if not nome_limpo:
            raise HTTPException(400, "Nome da empresa é obrigatório")
        tenant.nome = nome_limpo
    await db.commit()
    await db.refresh(tenant)
    return {
        "id": tenant.id,
        "nome": tenant.nome,
        "nome_pessoa": tenant.nome_pessoa,
        "avatar_url": tenant.avatar_url,
        "email": tenant.email,
        "sku": tenant.sku,
        "status": tenant.status,
    }


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(__import__("core.auth", fromlist=["get_current_user"]).get_current_user),
):
    """Upload da foto de perfil → R2 → salva avatar_url no tenant."""
    if not user.tenant_id:
        raise HTTPException(404, "Tenant não encontrado")
    tenant = await db.get(TaTenant, user.tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant não encontrado")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Imagem maior que 5MB")
    ctype = (file.content_type or "").lower()
    if not ctype.startswith("image/"):
        raise HTTPException(400, "Envie uma imagem (PNG, JPG, WEBP)")
    up = storage.upload(content, folder="avatars", filename=file.filename, content_type=ctype)
    tenant.avatar_url = up["url"]
    await db.commit()
    return {"avatar_url": tenant.avatar_url}


@router.delete("/me/avatar")
async def delete_avatar(
    db: AsyncSession = Depends(get_db),
    user=Depends(__import__("core.auth", fromlist=["get_current_user"]).get_current_user),
):
    if not user.tenant_id:
        raise HTTPException(404, "Tenant não encontrado")
    tenant = await db.get(TaTenant, user.tenant_id)
    if not tenant:
        raise HTTPException(404, "Tenant não encontrado")
    tenant.avatar_url = None
    await db.commit()
    return {"avatar_url": None}


@router.get("/me/setup-status")
async def setup_status(
    db: AsyncSession = Depends(get_db),
    user=Depends(__import__("core.auth", fromlist=["get_current_user"]).get_current_user),
):
    """Checklist de onboarding — o que o tenant já configurou pro agente funcionar.

    `ready` = mínimo pra o agente operar (persona + LLM própria). Embedding/RAG é
    automático (default global), então não entra como passo obrigatório."""
    tid = user.tenant_id
    empty = {
        "has_agent": False, "has_persona": False, "has_llm": False, "has_embedding": False,
        "has_knowledge": False, "has_channel": False, "ready": False,
    }
    if not tid:
        return empty

    async def ex(q: str) -> bool:
        try:
            return bool((await db.execute(sql_text(q), {"t": tid})).scalar())
        except Exception:
            return False

    has_agent = await ex("SELECT EXISTS(SELECT 1 FROM ta_agent WHERE tenant_id = :t)")
    has_persona = await ex(
        "SELECT EXISTS(SELECT 1 FROM ta_agent WHERE tenant_id = :t AND persona IS NOT NULL AND btrim(persona) <> '')"
    )
    has_llm = await ex(
        "SELECT EXISTS(SELECT 1 FROM ta_llm_provider WHERE tenant_id = :t AND active = true)"
    )
    has_embedding = await ex(
        "SELECT EXISTS(SELECT 1 FROM ta_embedding_provider WHERE tenant_id = :t AND active = true)"
    )
    has_knowledge = await ex(
        "SELECT EXISTS(SELECT 1 FROM ta_knowledge k JOIN ta_agent a ON a.id = k.agent_id WHERE a.tenant_id = :t)"
    )
    has_channel = await ex(
        "SELECT EXISTS(SELECT 1 FROM ta_connector c JOIN ta_agent a ON a.id = c.agent_id "
        "WHERE a.tenant_id = :t AND c.enabled = true)"
    )
    return {
        "has_agent": has_agent,
        "has_persona": has_persona,
        "has_llm": has_llm,
        "has_embedding": has_embedding,
        "has_knowledge": has_knowledge,
        "has_channel": has_channel,
        "ready": has_llm and has_persona,
    }
