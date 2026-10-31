"""Simulação de conversas na conta FICTÍCIA (Agent local, Postgres local) — nunca em conta real.

1) Clientes novos mandam mensagem para os números de 50 consultores, de 5 números divididos e da
   OUTRA empresa — pelo mesmo webhook (assinado) por onde o WhatsApp entrega.
2) Os consultores respondem pelo celular (mensagem que SAI pelo número), cada um com o seu perfil.
3) O número do «Paulo Santana» responde com o perfil «Rebecca» — o caso da M7.
Durante tudo isso, 60 pessoas usam o sistema (lista, abre conversa, sino, fila) e TODA resposta é
conferida. No fim: conversa por conversa no banco, e cada perfil entrando pelo login.

Uso: python simula_conversas.py <ids.json> <pg_dsn>
"""

import asyncio
import hashlib
import hmac
import json
import random
import re
import sys
import time

import asyncpg
import httpx

BASE = "http://127.0.0.1:8100/api/v1"
SEGREDO = b"segredo-do-webhook-so-local"
with open(sys.argv[1]) as _f:
    IDS = json.load(_f)
DSN = sys.argv[2]
SENHA = "Teste@2026"
MARCA = re.compile(r"(?:CLI|NOVO)-(C\d{2}|S\d|T2)-\d{4}")
TODOS_T1 = {f"C{k:02d}" for k in range(1, 51)} | {f"S{s}" for s in range(1, 6)}
CLIENTES_POR_NUMERO, MSGS_POR_CLIENTE = 4, 3

NOMES = {1: "Paulo Santana", 2: "Rebecca Pandolfo"}


def nome_consultor(k):
    return NOMES.get(k, f"Consultor {k:02d}")


def permitido(p):
    if p["papel"] != "atendente":
        return TODOS_T1
    divs = {f"S{s}" for s, membros in IDS["divididos"].items() if p["mid"] in membros}
    return {f"C{p['k']:02d}"} | divs


def evento(instancia, remoto, texto, de_mim, perfil, seq):
    corpo = {
        "instance_id": instancia,
        "tenant_id": "local",
        "event": "messages.upsert",
        "timestamp": int(time.time()),
        "data": {
            "key": {"id": f"SIM{seq:07d}", "remoteJid": f"{remoto}@s.whatsapp.net", "fromMe": de_mim},
            "pushName": perfil,
            "message": {"conversation": texto},
            "messageTimestamp": int(time.time()),
        },
    }
    raw = json.dumps(corpo).encode()
    return raw, "sha256=" + hmac.new(SEGREDO, raw, hashlib.sha256).hexdigest()


def montar_eventos():
    """Lista de (instância, cliente, texto, de_mim, perfil, dono esperado)."""
    evs, fone = [], 5521980000000
    alvos = [(f"inst-{k}", f"C{k:02d}", nome_consultor(k)) for k in range(1, 51)]
    alvos += [(f"inst-{100 + s}", f"S{s}", "Equipe Fictícia") for s in range(1, 6)]
    alvos += [("inst-999", "T2", "Outra Empresa")]
    for inst, dono, perfil_do_numero in alvos:
        for n in range(1, CLIENTES_POR_NUMERO + 1):
            fone += 1
            cliente = f"NOVO-{dono}-{n:04d}"
            for i in range(MSGS_POR_CLIENTE):
                evs.append((inst, str(fone), f"Oi, aqui é {cliente} (mensagem {i + 1})", False, cliente, dono))
            # a consultora responde pelo celular; o número do Paulo responde com o perfil da Rebecca
            perfil = "Rebecca" if inst == "inst-1" else perfil_do_numero
            evs.append((inst, str(fone), f"Resposta para {cliente}", True, perfil, dono))
    # o número do Paulo manda mais algumas com o perfil «Rebecca» (passa do limite de aviso)
    for j in range(4):
        evs.append(("inst-1", "5521980000001", f"Outra resposta {j}", True, "Rebecca", "C01"))
    return evs


async def injetar(cli, evs, placar):
    sem = asyncio.Semaphore(25)
    seq = [0]

    async def um(ev):
        async with sem:
            seq[0] += 1
            raw, assinatura = evento(*ev[:5], seq[0])
            r = await cli.post(
                f"{BASE}/webhooks/whatsapp-engine",
                content=raw,
                headers={"Content-Type": "application/json", "X-Tier-Signature": assinatura},
            )
            placar["webhook"][r.status_code] = placar["webhook"].get(r.status_code, 0) + 1

    random.shuffle(evs)
    await asyncio.gather(*(um(e) for e in evs))


async def usar(cli, p, prazo, placar):
    h = {"Authorization": f"Bearer {p['token']}"}
    while time.monotonic() < prazo:
        url = random.choice(["/conversations?limit=300", "/notifications?status=all&limit=200", "/attention"])
        try:
            r = await asyncio.wait_for(cli.get(BASE + url, headers=h), 20)
        except Exception:  # noqa: BLE001
            placar["sem_resposta"] += 1
            continue
        placar["leituras"] += 1
        if r.status_code >= 500:
            placar["erros"] += 1
        if 200 <= r.status_code < 300:
            fora = {m.group(1) for m in MARCA.finditer(r.text)} - permitido(p)
            if fora:
                placar["violacoes"].append(f"{p['nome']} {url} viu {sorted(fora)[:5]}")


async def main():
    pg = await asyncpg.connect(DSN)
    await pg.execute("UPDATE ta_connector SET perfil_whatsapp=NULL, perfil_vezes=0, perfil_alertado=NULL")
    await pg.execute("DELETE FROM ta_notification WHERE payload_json::jsonb->>'tipo' = 'perfil_do_numero'")
    antes = await pg.fetchval("SELECT count(*) FROM ta_conversation WHERE contact_name LIKE 'NOVO-%'")
    async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=200)) as cli:
        pessoas = [
            {
                "nome": nome_consultor(k),
                "email": f"consultor{k:02d}@ficticia.teste",
                "papel": "atendente",
                "mid": IDS["cons"][k - 1],
                "k": k,
            }
            for k in range(1, 51)
        ]
        pessoas += [
            {
                "nome": f"Gestora {g}",
                "email": f"gestora{g}@ficticia.teste",
                "papel": "admin",
                "mid": IDS["gest"][g - 1],
                "k": 0,
            }
            for g in range(1, 6)
        ]
        pessoas += [{"nome": "Dono", "email": "dono@ficticia.teste", "papel": "owner", "mid": None, "k": 0}]
        for p in pessoas:
            r = await cli.post(f"{BASE}/auth/login", json={"email": p["email"], "password": SENHA})
            p["token"] = r.json()["access_token"]
        evs = montar_eventos()
        placar = {"webhook": {}, "leituras": 0, "erros": 0, "sem_resposta": 0, "violacoes": []}
        t0 = time.monotonic()
        prazo = t0 + 75
        usando = [usar(cli, random.choice(pessoas), prazo, placar) for _ in range(60)]
        await asyncio.gather(injetar(cli, evs, placar), *usando)
        print(
            f"{len(evs)} mensagens injetadas pelo webhook em {time.monotonic() - t0:.0f}s · respostas do webhook: {placar['webhook']}"
        )
        print(
            f"enquanto chegavam: {placar['leituras']} leituras de 60 pessoas · 5xx {placar['erros']} · "
            f"sem resposta {placar['sem_resposta']} · VIOLAÇÕES {len(placar['violacoes'])}"
        )
        for v in placar["violacoes"][:10]:
            print("   !!", v)

        # espera o processamento em segundo plano terminar
        ultimo, estavel = -1, 0
        while estavel < 3:
            n = await pg.fetchval("SELECT count(*) FROM ta_conversation WHERE contact_name LIKE 'NOVO-%'")
            estavel = estavel + 1 if n == ultimo else 0
            ultimo = n
            await asyncio.sleep(2)

        # 1) banco: cada conversa nova no número certo
        linhas = await pg.fetch(
            "SELECT c.contact_name, c.connector_id, c.msg_count, "
            "(SELECT count(*) FROM ta_message_log l WHERE l.conversation_id = c.id) AS msgs "
            "FROM ta_conversation c WHERE c.contact_name LIKE 'NOVO-%'"
        )
        num_de = {f"C{k:02d}": IDS["nums"][k - 1] for k in range(1, 51)}
        num_de.update({f"S{s}": IDS["divs"][s - 1] for s in range(1, 6)})
        num_de["T2"] = IDS["outro"]
        errados = [
            r["contact_name"] for r in linhas if r["connector_id"] != num_de[MARCA.match(r["contact_name"]).group(1)]
        ]
        msgs = [r["msgs"] for r in linhas]
        print(
            f"banco: {len(linhas) - antes} conversas novas (esperado {56 * CLIENTES_POR_NUMERO}) · no número errado: {len(errados)} · "
            f"mensagens por conversa: mín {min(msgs)} máx {max(msgs)}"
        )

        # 2) cada perfil entra e vê só o que é dele — inclusive as conversas novas
        problemas = []
        for p in pessoas:
            r = await cli.get(f"{BASE}/conversations?limit=300", headers={"Authorization": f"Bearer {p['token']}"})
            vistos = {m.group(0) for m in MARCA.finditer(r.text)}
            novos = {v for v in vistos if v.startswith("NOVO-")}
            esperados = {f"NOVO-{d}-{n:04d}" for d in permitido(p) for n in range(1, CLIENTES_POR_NUMERO + 1)}
            if p["papel"] == "atendente" and novos != esperados:
                problemas.append(
                    f"{p['nome']}: viu {len(novos)} novas, esperado {len(esperados)} (faltam {sorted(esperados - novos)[:3]}, sobram {sorted(novos - esperados)[:3]})"
                )
            if any("-T2-" in v for v in vistos):
                problemas.append(f"{p['nome']} viu conversa da OUTRA empresa")
        print(f"login de {len(pessoas)} perfis: cada um vê exatamente as suas novas → problemas {len(problemas)}")
        for x in problemas[:10]:
            print("   !!", x)

        # 3) o número do Paulo com o perfil da Rebecca: só a gestão é avisada
        g = next(p for p in pessoas if p["email"] == "gestora1@ficticia.teste")
        paulo = next(p for p in pessoas if p["k"] == 1)
        rebecca = next(p for p in pessoas if p["k"] == 2)
        aviso = "WhatsApp de «Rebecca»"
        for p in (g, paulo, rebecca):
            r = await cli.get(
                f"{BASE}/notifications?status=all&limit=200", headers={"Authorization": f"Bearer {p['token']}"}
            )
            print(f"sino de {p['nome']}: aviso do perfil {'APARECE' if aviso in r.text else 'não aparece'}")
        r = await cli.get(f"{BASE}/connectors", headers={"Authorization": f"Bearer {g['token']}"})
        n1 = next(c for c in r.json() if c["id"] == IDS["nums"][0])
        n5 = next(c for c in r.json() if c["id"] == IDS["nums"][4])
        print(
            f"Números (gestora): nº do Paulo perfil «{n1['perfil_whatsapp']}» confere={n1['perfil_confere']} · "
            f"nº do Consultor 05 perfil «{n5['perfil_whatsapp']}» confere={n5['perfil_confere']}"
        )

        # 4) quem abriu: o Consultor 07 abre 2 conversas dele; a gestora vê
        c7 = next(p for p in pessoas if p["k"] == 7)
        ids7 = [
            r["id"]
            for r in await pg.fetch(
                "SELECT id FROM ta_conversation WHERE connector_id = $1 AND contact_name LIKE 'NOVO-%' ORDER BY id LIMIT 2",
                IDS["nums"][6],
            )
        ]
        for cid in ids7:
            for _ in range(3):  # a tela se atualiza sozinha: conta 1 vez
                await cli.get(f"{BASE}/conversations/{cid}", headers={"Authorization": f"Bearer {c7['token']}"})
        r = await cli.get(
            f"{BASE}/acessos?member_id={c7['mid']}&dias=1", headers={"Authorization": f"Bearer {g['token']}"}
        )
        print(f"quem abriu (vista da gestora): Consultor 07 → {r.json()['resumo']}")
        r = await cli.get(f"{BASE}/acessos?dias=1", headers={"Authorization": f"Bearer {c7['token']}"})
        print(f"o Consultor 07 tentando ver o registro: {r.status_code}")

        # 5) fechar o Atendimento: só o dono entra; reabrir
        await cli.post(f"{BASE}/tenants/me/atendimento/fechar", headers={"Authorization": f"Bearer {g['token']}"})
        dono = next(p for p in pessoas if p["papel"] == "owner")
        st = {
            p["nome"]: (
                await cli.get(f"{BASE}/conversations", headers={"Authorization": f"Bearer {p['token']}"})
            ).status_code
            for p in (c7, g, dono)
        }
        print(f"Atendimento FECHADO: {st}")
        await cli.post(f"{BASE}/tenants/me/atendimento/abrir", headers={"Authorization": f"Bearer {dono['token']}"})
        st = (await cli.get(f"{BASE}/conversations", headers={"Authorization": f"Bearer {c7['token']}"})).status_code
        print(f"reaberto pelo dono: Consultor 07 → {st}")
    await pg.close()


asyncio.run(main())
