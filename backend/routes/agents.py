from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import CurrentUser, get_current_user
from core.db import get_db
from models import TaAgent
from services import agent_runtime, templates as tpl

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentCreate(BaseModel):
    nome: str
    persona: str | None = None
    system_prompt: str | None = None
    template_kind: str | None = None
    avatar_url: str | None = None


class AgentOut(BaseModel):
    id: int
    tenant_id: int
    nome: str
    persona: str | None
    system_prompt: str | None
    template_kind: str | None
    avatar_url: str | None = None
    # Escolha de modelo DESTE agente; vazio = herda o default do tenant.
    llm_model: str | None = None
    llm_provider_id: int | None = None
    active: bool

    model_config = {"from_attributes": True}


async def _ensure_tenant(user: CurrentUser) -> int:
    if not user.tenant_id:
        raise HTTPException(403, "Usuário sem tenant — finalize signup")
    return user.tenant_id


@router.get("", response_model=list[AgentOut])
async def list_agents(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    result = await db.execute(
        select(TaAgent).where(TaAgent.tenant_id == tenant_id).order_by(TaAgent.id.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=AgentOut, status_code=201)
async def create_agent(
    payload: AgentCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    data = payload.model_dump()

    # Se template_kind bate em template conhecido, aplica persona + system_prompt do template
    # (user ainda pode sobrescrever passando os campos explicitamente)
    if data.get("template_kind"):
        t = tpl.get_template(data["template_kind"])
        if t:
            if not data.get("persona"):
                data["persona"] = t.persona
            if not data.get("system_prompt"):
                data["system_prompt"] = t.system_prompt

    agent = TaAgent(tenant_id=tenant_id, **data)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("/{agent_id}", response_model=AgentOut)
async def get_agent(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    return agent


class AgentUpdate(BaseModel):
    """Patch parcial — todos campos opcionais (PATCH semantic)."""
    nome: str | None = None
    persona: str | None = None
    system_prompt: str | None = None
    template_kind: str | None = None
    avatar_url: str | None = None
    # "" limpa a escolha e volta a herdar o default do tenant.
    llm_model: str | None = None
    llm_provider_id: int | None = None
    active: bool | None = None


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: int,
    payload: AgentUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    data = payload.model_dump(exclude_unset=True)
    persona_or_prompt_changed = any(k in data for k in ("persona", "system_prompt"))
    if "nome" in data and data["nome"] is not None:
        nome = data["nome"].strip()
        if not nome:
            raise HTTPException(400, "Nome não pode ser vazio")
        agent.nome = nome
    for k in ("persona", "system_prompt", "template_kind", "active", "avatar_url"):
        if k in data:
            setattr(agent, k, data[k])

    # Modelo do agente: string vazia = "voltar a herdar o default do tenant".
    if "llm_model" in data:
        agent.llm_model = (data["llm_model"] or "").strip() or None
    if "llm_provider_id" in data:
        pid = data["llm_provider_id"]
        if pid:
            from models import TaLlmProvider

            ok = (
                await db.execute(
                    select(TaLlmProvider.id).where(
                        TaLlmProvider.id == pid, TaLlmProvider.tenant_id == tenant_id
                    )
                )
            ).first()
            if not ok:
                raise HTTPException(400, "Provider não pertence a esta conta")
        agent.llm_provider_id = pid or None

    await db.commit()
    await db.refresh(agent)
    if persona_or_prompt_changed:
        try:
            from services import llm_cache

            await llm_cache.invalidate(agent.tenant_id, agent.id)
        except Exception:
            pass
    return agent


@router.post("/{agent_id}/toggle-active", response_model=AgentOut)
async def toggle_active(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Liga/desliga o agente sem afetar dados."""
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    agent.active = not agent.active
    await db.commit()
    await db.refresh(agent)
    return agent


class AgentStats(BaseModel):
    agent_id: int
    playbooks_total: int
    playbooks_published: int
    conversations_total: int
    conversations_active: int
    knowledge_total: int
    connectors_total: int


@router.get("/{agent_id}/stats", response_model=AgentStats)
async def agent_stats(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Métricas rápidas pro drawer de detalhes."""
    from sqlalchemy import func
    from models import (
        TaConnector,
        TaConversation,
        TaKnowledge,
        TaPlaybook,
    )

    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    async def _count(stmt):
        return (await db.execute(stmt)).scalar_one() or 0

    pb_total = await _count(
        select(func.count(TaPlaybook.id)).where(TaPlaybook.agent_id == agent_id)
    )
    pb_pub = await _count(
        select(func.count(TaPlaybook.id)).where(
            TaPlaybook.agent_id == agent_id, TaPlaybook.status == "published"
        )
    )
    conv_total = await _count(
        select(func.count(TaConversation.id)).where(TaConversation.agent_id == agent_id)
    )
    conv_active = await _count(
        select(func.count(TaConversation.id)).where(
            TaConversation.agent_id == agent_id, TaConversation.status == "active"
        )
    )
    kn_total = await _count(
        select(func.count(TaKnowledge.id)).where(TaKnowledge.agent_id == agent_id)
    )
    conn_total = await _count(
        select(func.count(TaConnector.id)).where(TaConnector.agent_id == agent_id)
    )

    return AgentStats(
        agent_id=agent_id,
        playbooks_total=pb_total,
        playbooks_published=pb_pub,
        conversations_total=conv_total,
        conversations_active=conv_active,
        knowledge_total=kn_total,
        connectors_total=conn_total,
    )


@router.get("/{agent_id}/memories")
async def list_memories(
    agent_id: int,
    contact: str,
    limit: int = 100,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lista memórias salvas pra um contato específico do agente.

    Query params:
        contact: external_chat_id (WhatsApp number, Telegram chat_id, etc)
        limit: max rows (default 100, max 500)
    """
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    from services import memory_service

    items = await memory_service.list_for_contact(
        db,
        agent_id=agent_id,
        external_chat_id=contact,
        limit=max(1, min(limit, 500)),
    )
    return {"agent_id": agent_id, "contact": contact, "memories": items, "count": len(items)}


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(
    memory_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove fato específico (admin override)."""
    tenant_id = await _ensure_tenant(user)
    from services import memory_service

    ok = await memory_service.delete_memory(db, memory_id=memory_id, tenant_id=tenant_id)
    if not ok:
        raise HTTPException(404, "Memória não encontrada")


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove o agente + cascade (playbooks, conversations, knowledge, connectors,
    notifications, executions, triggers — tudo via ondelete=CASCADE nos FKs).

    OPERAÇÃO DESTRUTIVA — sem recuperação.
    """
    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")
    await db.delete(agent)
    await db.commit()


@router.get("/{agent_id}/runtime-config")
async def agent_runtime_config(
    agent_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """O que ESTE agente usa de verdade em execução — pra tela do agente mostrar
    modelo e recuperação num lugar só, sem o usuário caçar em Configurações.

    Separação (mesmo desenho do Dify):
    - credencial LLM: por conta (`scope: tenant`) — a chave nunca aparece aqui
    - modelo: por agente (`inherited=false`) ou herdado do default da conta
    - embedding: por conta e **travado**: a coluna pgvector é vector(768), então
      todo provider precisa emitir 768 dims. Por isso vai como leitura.
    """
    from models import TaEmbeddingProvider, TaKnowledge, TaLlmProvider

    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    llms = list(
        (
            await db.execute(
                select(TaLlmProvider)
                .where(TaLlmProvider.tenant_id == tenant_id, TaLlmProvider.active.is_(True))
                .order_by(TaLlmProvider.priority.asc(), TaLlmProvider.id.desc())
            )
        ).scalars().all()
    )
    # O padrão da conta é o primeiro desta ordem (priority asc, id desc) — a MESMA
    # que o motor usa. `chosen` é o que ESTE agente usa: a credencial apontada,
    # se houver, senão o padrão.
    padrao_conta = llms[0] if llms else None
    chosen = next((p for p in llms if p.id == agent.llm_provider_id), None) or padrao_conta
    # 🚨 "Herdado" é usar o padrão da conta, e um agente sai dele de DUAS formas:
    # escrevendo um modelo próprio OU apontando para outra credencial. Olhando só
    # a primeira, um agente que aponta para outra chave apareceria como
    # "herda o padrão da conta" enquanto roda outro modelo — que é exatamente a
    # frase errada que fez o dono passar dois meses achando que rodava DeepSeek.
    herda = not agent.llm_model and (
        not agent.llm_provider_id or (padrao_conta is not None and agent.llm_provider_id == padrao_conta.id)
    )

    emb = (
        await db.execute(
            select(TaEmbeddingProvider)
            .where(
                TaEmbeddingProvider.tenant_id.in_([tenant_id, None]),
                TaEmbeddingProvider.active.is_(True),
            )
            .order_by(TaEmbeddingProvider.priority.asc(), TaEmbeddingProvider.id.desc())
        )
    ).scalars().first()

    docs = list(
        (
            await db.execute(
                select(TaKnowledge).where(TaKnowledge.agent_id == agent_id).order_by(TaKnowledge.id.desc())
            )
        ).scalars().all()
    )

    return {
        "llm": {
            "scope": "tenant",
            "provider": chosen.provider if chosen else None,
            "model": agent.llm_model or (chosen.default_model if chosen else None),
            "inherited": herda,
            # O padrão da CONTA, não o que este agente escolheu — é o valor ao
            # qual ele volta se soltar a escolha.
            "tenant_default_model": padrao_conta.default_model if padrao_conta else None,
            "provider_id": chosen.id if chosen else None,
            "fallback": [f.get("model") for f in (chosen.fallback_chain_json or []) if isinstance(f, dict)]
            if chosen
            else [],
            "options": [
                {"id": p.id, "provider": p.provider, "default_model": p.default_model} for p in llms
            ],
        },
        "embedding": {
            "scope": "tenant",
            "locked_reason": "A coluna de vetores é fixa em 768 dimensões — trocar aqui quebraria a busca de todos os agentes.",
            "provider": emb.provider if emb else None,
            "model": emb.default_model if emb else None,
            "dimensions": emb.dimensions if emb else 768,
        },
        "knowledge": {
            "total": len(docs),
            "ready": sum(1 for d in docs if d.status == "ready"),
            "failed": sum(1 for d in docs if d.status == "failed"),
            "chunks": sum(int(d.chunks_count or 0) for d in docs),
            "items": [
                {
                    "id": d.id,
                    "title": d.title,
                    "kind": d.kind,
                    "status": d.status,
                    "chunks_count": d.chunks_count,
                }
                for d in docs[:50]
            ],
        },
    }


class PlaygroundIn(BaseModel):
    message: str
    history: list[dict] | None = None
    # Simulam o que o canal entrega em produção. Sem eles o agente não sabe com
    # quem fala e o `{nome}` da persona não resolve — o teste sai diferente do
    # WhatsApp por um motivo que não aparece na tela.
    contact_name: str | None = None
    contact_phone: str | None = None


@router.post("/{agent_id}/playground")
async def agent_playground(
    agent_id: int,
    payload: PlaygroundIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Conversa de teste com o agente, sem canal e sem gravar conversa.

    Usa a MESMA persona, o mesmo modelo e as mesmas ferramentas que o agente usa
    em produção — senão o teste não vale. Passa `agent_id` pro engine aplicar a
    escolha de modelo do agente e federar as tools dele.

    `use_cache=False` de propósito: em teste você quer ver o que o modelo responde
    agora, não uma resposta guardada de uma pergunta igual.
    """
    from services import tier_engine

    tenant_id = await _ensure_tenant(user)
    agent = await db.get(TaAgent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agente não encontrado")

    msg = (payload.message or "").strip()
    if not msg:
        raise HTTPException(400, "Mensagem vazia")

    # MESMA precedência da produção (agent_runtime: `persona or system_prompt`).
    # Estava invertida aqui — e como todo agente de template nasce com os DOIS
    # campos preenchidos, o prompt testado nunca era o prompt executado.
    system = agent.persona or agent.system_prompt or None

    # RAG: o teste consulta a base de conhecimento pelo MESMO caminho da produção
    # (services.agent_runtime.build_rag_block). Sem isso o cliente subia um
    # documento, testava, o agente não sabia, e concluía que a indexação quebrou.
    # Memória entre conversas continua de fora: ela é por CONTATO, e o playground
    # não tem contato — não existe o que buscar.
    rag_bloco, rag_fontes = await agent_runtime.build_rag_block(db, agent.id, msg)
    if rag_bloco:
        system = f"{system}\n\n{rag_bloco}" if system else rag_bloco

    # Canal simulado: o teste vale pelo canal em que o agente atende. Se ele tem
    # conector, usa o kind real — assim entram as regras de formatação do WhatsApp
    # e o bloco de contato no mesmo formato da produção.
    from models import TaConnector

    kind = (
        await db.execute(
            select(TaConnector.kind)
            .where(TaConnector.agent_id == agent.id, TaConnector.enabled.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none() or "whatsapp"

    # Os blocos que a produção injeta e o playground não injetava: contato,
    # data/hora atual, diretrizes genéricas, guidelines do template e regras de
    # formatação do canal. Faltando isso, o agente no painel não sabia nem que dia
    # era hoje — e o teste divergia do WhatsApp por motivo invisível.
    system = (system or "") + "\n\n" + agent_runtime.build_contact_block(
        connector_kind=kind,
        external_chat_id=payload.contact_phone or None,
        sender_name=payload.contact_name or None,
    )
    system += "\n\n" + agent_runtime.build_base_directives(agent, connector_kind=kind)

    history = [
        {"role": h.get("role"), "content": h.get("content")}
        for h in (payload.history or [])
        if h.get("role") in ("user", "assistant") and h.get("content")
    ][-20:]

    try:
        reply = await tier_engine.send_message(
            tenant_id,
            msg,
            db,
            system_override=system,
            agent_id=agent.id,
            history=history or None,
            use_cache=False,
            session_id=f"playground-{agent.id}",
        )
    except Exception as e:  # noqa: BLE001 — inclui ProvidersAllDisabled
        raise HTTPException(502, f"O agente não respondeu: {e}") from e

    # Mesmo tratamento de saída da produção, na MESMA ordem: limpa CJK/bandeira
    # vazados, converte markdown pra formatação nativa do canal e quebra em balões.
    # Sem isto o painel mostrava `**negrito**` e um bloco único gigante, enquanto o
    # cliente recebia texto formatado em até 4 mensagens.
    limpo = agent_runtime._sanitize_reply(reply.text)
    if kind in ("whatsapp", "whatsapp_cloud"):
        limpo = agent_runtime._format_for_whatsapp(limpo)
    bolhas = agent_runtime._split_into_bubbles(limpo)

    return {
        # `text` mantido pra compatibilidade; o painel novo lê `bubbles`.
        "text": limpo,
        "bubbles": bolhas,
        "model_used": getattr(reply, "model_used", None),
        "canal": kind,
        # o painel carimba embaixo da resposta o que foi de fato consultado
        "rag_fontes": rag_fontes,
        "rag_usado": bool(rag_bloco),
    }
