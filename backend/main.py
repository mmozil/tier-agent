"""Tier Agent — control plane FastAPI."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from routes import agents, auth, billing, connectors, containers, features, health, knowledge, llm, mcp_server, metrics, notifications, playbooks, skills, templates, tenants, tier_pay, webhooks

settings = get_settings()

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("tier-agent")

app = FastAPI(
    title="Tier Agent — Control Plane",
    description="SaaS de agentes IA configuráveis. Multi-tenant via 1 container Hermes por cliente.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://agent.tier.finance",
        "https://app.tier.finance",
        "https://erp.tier.finance",
        "http://localhost:5174",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "tier-agent",
        "version": "0.1.0",
        "environment": settings.environment,
        "docs": "/docs",
    }


# Routers
app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(tenants.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")
app.include_router(llm.router, prefix="/api/v1")
app.include_router(features.router, prefix="/api/v1")
app.include_router(containers.router, prefix="/api/v1")
app.include_router(connectors.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")
app.include_router(templates.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")
app.include_router(playbooks.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(skills.router, prefix="/api/v1")
app.include_router(tier_pay.router, prefix="/api/v1")
app.include_router(mcp_server.router, prefix="/api/v1")


@app.on_event("startup")
async def startup():
    logger.info("Tier Agent starting — env=%s port=%s", settings.environment, settings.app_port)
    from scheduler import init_scheduler
    init_scheduler()


@app.on_event("shutdown")
async def shutdown():
    logger.info("Tier Agent shutting down")
    from scheduler import shutdown_scheduler
    shutdown_scheduler()
