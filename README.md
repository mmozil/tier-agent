# Tier Agent

Plataforma SaaS de agentes IA configuráveis. 5º produto do ecossistema Tier.

**Subdomínio:** `agent.tier.finance`

## Estrutura

```
backend/    FastAPI control plane (Python 3.11)
frontend/   React + Vite + Tailwind (admin + tenant dashboards)
infra/      Dockerfile derivado + docker-compose + Coolify config
.docs/      Architecture, runbooks, decisions
```

## Status

🚧 Em construção — Fase 1 Foundation (mai/2026).

Arquitetura inspirada em Hermes Agent (NousResearch) — skills + memória persistente + Honcho user modeling + curator + cron + sub-agents. Construído do zero (sem fork) com multi-tenant first-class via 1 container por tenant.

## Decisões canônicas

Ver [`.docs/decisoes.md`](.docs/decisoes.md) e plano em `C:\Users\marce\.claude\plans\gostaria-que-ele-fosse-dynamic-star.md`.

## Dev local

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8100

# Frontend
cd frontend
npm install
npm run dev   # porta 5174 (proxy /api → backend:8100)
```
