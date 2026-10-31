"""Empresa fictícia em escala (10x o CCDA) no Postgres LOCAL — nunca em produção.

55 pessoas (50 consultores, 5 gestores) + dono, 55 números (50 de um consultor só,
5 divididos), 5.000 conversas, 50.000 mensagens, 1.000 avisos. E uma 2ª empresa.
Cada cliente leva no nome a marca de quem é dono: CLI-C07-0012 é do consultor 07,
CLI-S2-0003 do número dividido 2, CLI-T2-0001 da outra empresa.

Uso: DATABASE_URL=... python carga_semear.py <pasta do backend>
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
os.chdir(sys.argv[1])

from sqlalchemy import insert, text  # noqa: E402

import main  # noqa: E402
from core.db import Base, SessionLocal, engine  # noqa: E402
from core.encryption import encrypt  # noqa: E402
from models import TaAgent, TaConnector, TaConversation, TaMember, TaMessageLog, TaNotification, TaTenant  # noqa: E402
from routes.auth import pwd_ctx  # noqa: E402

SENHA = "Teste@2026"
N_CONS, N_GEST, N_DIV = 50, 5, 5
POR_NUMERO, POR_DIVIDIDO, MSGS = 90, 100, 10


async def run():
    async with engine.begin() as con:
        await con.run_sync(Base.metadata.create_all)
    for nome in [n for n in dir(main) if n.startswith("_ensure_")]:
        await getattr(main, nome)()
    async with engine.begin() as con:
        tabs = (await con.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))).scalars().all()
        await con.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tabs) + " RESTART IDENTITY CASCADE"))

    h = pwd_ctx.hash(SENHA)
    async with SessionLocal() as db:
        t1 = TaTenant(
            nome="Empresa Fictícia (teste de carga)",
            email="dono@ficticia.teste",
            password_hash=h,
            sku="pro",
            status="active",
        )
        t2 = TaTenant(
            nome="Outra Empresa (não pode aparecer)",
            email="dono@outra.teste",
            password_hash=h,
            sku="pro",
            status="active",
        )
        db.add_all([t1, t2])
        await db.flush()
        cons = [
            TaMember(
                tenant_id=t1.id,
                nome=f"Consultor {k:02d}",
                email=f"consultor{k:02d}@ficticia.teste",
                password_hash=h,
                role="atendente",
                status="active",
            )
            for k in range(1, N_CONS + 1)
        ]
        gest = [
            TaMember(
                tenant_id=t1.id,
                nome=f"Gestora {k}",
                email=f"gestora{k}@ficticia.teste",
                password_hash=h,
                role="admin",
                status="active",
            )
            for k in range(1, N_GEST + 1)
        ]
        db.add_all(cons + gest)
        ag1 = TaAgent(tenant_id=t1.id, nome="Atendimento Fictício", active=True)
        ag2 = TaAgent(tenant_id=t2.id, nome="Agente da Outra", active=True)
        db.add_all([ag1, ag2])
        await db.flush()

        def cfg(i):
            return encrypt(
                json.dumps(
                    {
                        "instance_id": f"inst-{i}",
                        "api_key": f"k-{i}",
                        "label": f"Número {i}",
                        "phone": f"55119000{i:05d}",
                    }
                )
            )

        nums = [
            TaConnector(
                agent_id=ag1.id, kind="whatsapp", config_json_enc=cfg(k), enabled=True, modo="registro", member_id=c.id
            )
            for k, c in enumerate(cons, 1)
        ]
        divs = [
            TaConnector(
                agent_id=ag1.id,
                kind="whatsapp",
                config_json_enc=cfg(100 + k),
                enabled=True,
                modo="registro",
                member_id=None,
            )
            for k in range(1, N_DIV + 1)
        ]
        outro = TaConnector(agent_id=ag2.id, kind="whatsapp", config_json_enc=cfg(999), enabled=True, modo="registro")
        db.add_all(nums + divs + [outro])
        await db.commit()
        ids = dict(
            t1=t1.id,
            t2=t2.id,
            ag1=ag1.id,
            ag2=ag2.id,
            cons=[c.id for c in cons],
            gest=[g.id for g in gest],
            nums=[n.id for n in nums],
            divs=[d.id for d in divs],
            outro=outro.id,
        )

    # número dividido S{s} é dos consultores 10s+1..10s+5 (5 pessoas cada)
    divididos = {s: [ids["cons"][10 * (s - 1) + j] for j in range(5)] for s in range(1, N_DIV + 1)}
    async with engine.begin() as con:
        for s, membros in divididos.items():
            for m in membros:
                await con.execute(
                    text("INSERT INTO ta_connector_membro (connector_id, member_id) VALUES (:c, :m)"),
                    {"c": ids["divs"][s - 1], "m": m},
                )

    convs = []
    fone = 5511910000000
    for k, num in enumerate(ids["nums"], 1):
        for n in range(1, POR_NUMERO + 1):
            fone += 1
            convs.append(
                dict(
                    agent_id=ids["ag1"],
                    connector_kind="whatsapp",
                    external_id=str(fone),
                    contact_name=f"CLI-C{k:02d}-{n:04d}",
                    status="handed_off" if n % 9 == 0 else "active",
                    msg_count=MSGS,
                    connector_id=num,
                    tags=[],
                    priority="none",
                    csat_state="none",
                    followup_step=0,
                )
            )
    for s, num in enumerate(ids["divs"], 1):
        for n in range(1, POR_DIVIDIDO + 1):
            fone += 1
            convs.append(
                dict(
                    agent_id=ids["ag1"],
                    connector_kind="whatsapp",
                    external_id=str(fone),
                    contact_name=f"CLI-S{s}-{n:04d}",
                    status="active",
                    msg_count=MSGS,
                    connector_id=num,
                    tags=[],
                    priority="none",
                    csat_state="none",
                    followup_step=0,
                )
            )
    for n in range(1, 11):
        fone += 1
        convs.append(
            dict(
                agent_id=ids["ag2"],
                connector_kind="whatsapp",
                external_id=str(fone),
                contact_name=f"CLI-T2-{n:04d}",
                status="handed_off",
                msg_count=MSGS,
                connector_id=ids["outro"],
                tags=[],
                priority="none",
                csat_state="none",
                followup_step=0,
            )
        )
    async with engine.begin() as con:
        res = await con.execute(
            insert(TaConversation).returning(
                TaConversation.id, TaConversation.contact_name, TaConversation.external_id
            ),
            convs,
        )
        rows = res.all()
        msgs, avisos = [], []
        for cid, nome, ext in rows:
            for i in range(MSGS):
                msgs.append(
                    dict(
                        conversation_id=cid,
                        role="user" if i % 2 == 0 else "assistant",
                        content=f"MSG {nome} #{i}",
                        tokens_in=0,
                        tokens_out=0,
                        cost_cents=0,
                        latency_ms=0,
                    )
                )
            if int(nome[-4:]) % 5 == 0:
                tenant = ids["t2"] if "-T2-" in nome else ids["t1"]
                agente = ids["ag2"] if "-T2-" in nome else ids["ag1"]
                avisos.append(
                    dict(
                        tenant_id=tenant,
                        agent_id=agente,
                        conversation_id=cid,
                        category="handoff",
                        title=f"{nome} quer falar com humano",
                        body=f"MSG {nome}",
                        status="unread",
                        payload_json={"contato": nome, "telefone": ext},
                    )
                )
        for i in range(0, len(msgs), 5000):
            await con.execute(insert(TaMessageLog), msgs[i : i + 5000])
        await con.execute(insert(TaNotification), avisos)
        await con.execute(text("ANALYZE"))
    ids["divididos"] = divididos
    ids["n_conversas"], ids["n_mensagens"], ids["n_avisos"] = len(rows), len(msgs), len(avisos)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "carga_ids.json"), "w") as f:
        json.dump(ids, f, indent=1)
    print(
        {k: ids[k] for k in ("n_conversas", "n_mensagens", "n_avisos")},
        "pessoas:",
        len(ids["cons"]) + len(ids["gest"]) + 1,
    )


asyncio.run(run())
