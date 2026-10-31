"""Teste de carga e estresse da regra «ninguém vê a conversa do outro» — Agent LOCAL.

Fases de carga: 10 → 25 → 50 → 100 → 200 pessoas ao mesmo tempo, cada uma fazendo o que
um atendente faz (lista, abre conversa, sino, fila, busca por telefone) e TAMBÉM tentando
abrir e escrever na conversa dos outros. Toda resposta é conferida: qualquer cliente que
não é da pessoa é VIOLAÇÃO.

Fase de caos: com 50 pessoas usando, o cargo de consultores é trocado (atendente ↔ admin)
e gente é desligada e religada a cada segundo. Pedido que começou DEPOIS da troca gravada
tem de obedecer o cargo novo.

Uso: python carga_teste.py <base_url> <ids.json> <pg_dsn> [segundos_por_fase]
"""

import asyncio
import json
import random
import re
import statistics
import sys
import time

import asyncpg
import httpx

BASE = sys.argv[1].rstrip("/") + "/api/v1"
with open(sys.argv[2]) as _f:
    IDS = json.load(_f)
DSN = sys.argv[3]
SEG = int(sys.argv[4]) if len(sys.argv) > 4 else 30
SENHA = "Teste@2026"
MARCA = re.compile(r"(?:CLI|NOVO)-(C\d{2}|S\d|T2)-\d{4}")  # NOVO- = conversas criadas pela simulação
TODOS_T1 = {f"C{k:02d}" for k in range(1, 51)} | {f"S{s}" for s in range(1, 6)}


def permitido(persona: dict) -> set:
    if persona["papel"] != "atendente":
        return TODOS_T1
    k = persona["k"]
    divs = {f"S{s}" for s, membros in IDS["divididos"].items() if persona["mid"] in membros}
    return {f"C{k:02d}"} | divs


async def entrar(cli, email):
    r = await cli.post(f"{BASE}/auth/login", json={"email": email, "password": SENHA})
    r.raise_for_status()
    return r.json()["access_token"]


class Placar:
    def __init__(self):
        self.lat = {}
        self.status = {}
        self.violacoes = []
        self.erros = 0
        self.timeouts = 0
        self.n = 0

    def anota(self, op, ms, st):
        self.lat.setdefault(op, []).append(ms)
        self.status[st] = self.status.get(st, 0) + 1
        self.n += 1
        if st >= 500:
            self.erros += 1

    def resumo(self, seg):
        todas = [x for v in self.lat.values() for x in v]

        def q(v, p):
            return round(statistics.quantiles(v, n=100)[p - 1]) if len(v) >= 2 else (round(v[0]) if v else 0)

        por_op = {
            op: {"n": len(v), "p50": q(v, 50), "p95": q(v, 95), "p99": q(v, 99)} for op, v in sorted(self.lat.items())
        }
        return {
            "pedidos": self.n,
            "por_seg": round(self.n / seg, 1),
            "p50_ms": q(todas, 50),
            "p95_ms": q(todas, 95),
            "p99_ms": q(todas, 99),
            "erros_5xx": self.erros,
            "timeouts": self.timeouts,
            "violacoes": len(self.violacoes),
            "status": self.status,
            "por_op": por_op,
        }


async def usuario(cli, persona, convs, prazo, placar, estado=None):
    meus = [c for c in convs if c["dono"] in permitido(persona)]
    alheios = [c for c in convs if c["dono"] not in permitido(persona)]
    h = {"Authorization": f"Bearer {persona['token']}"}
    while time.monotonic() < prazo:
        r_ = random.random()
        alvo = None
        if r_ < 0.30:
            op, metodo, url, kw = "lista", "GET", "/conversations?limit=100", {}
        elif r_ < 0.48 and meus:
            alvo = random.choice(meus)
            op, metodo, url, kw = "abre_minha", "GET", f"/conversations/{alvo['id']}", {}
        elif r_ < 0.68 and alheios:
            alvo = random.choice(alheios)
            op, metodo, url, kw = "abre_alheia", "GET", f"/conversations/{alvo['id']}", {}
        elif r_ < 0.78:
            op, metodo, url, kw = "sino", "GET", "/notifications?status=all&limit=200", {}
        elif r_ < 0.83:
            op, metodo, url, kw = "sino_contagem", "GET", "/notifications/stats", {}
        elif r_ < 0.88:
            op, metodo, url, kw = "fila", "GET", "/attention", {}
        elif r_ < 0.94 and alheios:
            op, metodo, url, kw = (
                "busca_fone_alheio",
                "GET",
                f"/conversations/por-telefone?telefone={random.choice(alheios)['fone']}",
                {},
            )
        elif alheios:
            alvo = random.choice(alheios)
            op, metodo, url, kw = (
                "nota_alheia",
                "POST",
                f"/conversations/{alvo['id']}/note",
                {"json": {"content": "tentativa"}},
            )
        else:
            continue
        t0 = time.monotonic()
        inicio = time.time()
        try:
            r = await asyncio.wait_for(cli.request(metodo, BASE + url, headers=h, **kw), 15)
        except (TimeoutError, httpx.HTTPError):
            placar.timeouts += 1
            continue
        fim = time.time()
        ms = (time.monotonic() - t0) * 1000
        placar.anota(op, ms, r.status_code)
        papel_no_inicio = estado.papel_em(persona["mid"], inicio, fim) if estado else persona["papel"]
        if papel_no_inicio is None:
            continue  # cargo mudou DURANTE o pedido: ambíguo, não conta
        if papel_no_inicio == "desligado":
            if r.status_code != 401:
                placar.violacoes.append(f"{persona['nome']} DESLIGADO recebeu {r.status_code} em {op}")
            continue
        if 200 <= r.status_code < 300:
            ok = TODOS_T1 if papel_no_inicio == "admin" else permitido({**persona, "papel": papel_no_inicio})
            vistos = {m.group(1) for m in MARCA.finditer(r.text)}
            fora = vistos - ok
            if fora:
                placar.violacoes.append(f"{persona['nome']} ({papel_no_inicio}) {op} {url} viu {sorted(fora)[:5]}")
            if alvo is not None and alvo["dono"] not in ok:
                placar.violacoes.append(
                    f"{persona['nome']} ({papel_no_inicio}) {op} {url} → {r.status_code} (conversa de {alvo['dono']}: devia ser recusado)"
                )


class Estado:
    """Linha do tempo do cargo de cada pessoa — gravada DEPOIS do commit no banco."""

    def __init__(self):
        self.mudancas = {}  # mid -> [(t, papel)]

    def grava(self, mid, papel):
        self.mudancas.setdefault(mid, []).append((time.time(), papel))

    def papel_em(self, mid, inicio, fim):
        hist = self.mudancas.get(mid)
        if not hist:
            return self._base.get(mid)
        antes = [p for t, p in hist if t <= inicio]
        durante = [p for t, p in hist if inicio < t <= fim + 0.05]
        if durante:
            return None
        return antes[-1] if antes else self._base.get(mid)


async def caos(pg, estado, personas, prazo):
    consultores = [p for p in personas if p["papel"] == "atendente"]
    trocas = 0
    while time.monotonic() < prazo:
        alvo = random.choice(consultores)
        await pg.execute("UPDATE ta_member SET role='admin' WHERE id=$1", alvo["mid"])
        estado.grava(alvo["mid"], "admin")
        await asyncio.sleep(0.4)
        await pg.execute("UPDATE ta_member SET role='atendente' WHERE id=$1", alvo["mid"])
        estado.grava(alvo["mid"], "atendente")
        outro = random.choice(consultores)
        await pg.execute("UPDATE ta_member SET status='disabled' WHERE id=$1", outro["mid"])
        estado.grava(outro["mid"], "desligado")
        await asyncio.sleep(0.4)
        await pg.execute("UPDATE ta_member SET status='active' WHERE id=$1", outro["mid"])
        estado.grava(outro["mid"], "atendente")
        trocas += 2
        await asyncio.sleep(0.2)
    return trocas


async def main():
    pg = await asyncpg.connect(DSN)
    linhas = await pg.fetch("SELECT id, contact_name, external_id FROM ta_conversation")
    convs = [
        {"id": r["id"], "dono": MARCA.match(r["contact_name"]).group(1), "fone": r["external_id"]}
        for r in linhas
        if r["contact_name"] and MARCA.match(r["contact_name"])
    ]
    limites = httpx.Limits(max_connections=400, max_keepalive_connections=400)
    async with httpx.AsyncClient(limits=limites, timeout=20) as cli:
        personas = [{"nome": "Dono", "email": "dono@ficticia.teste", "papel": "owner", "mid": None, "k": 0}]
        personas += [
            {
                "nome": f"Consultor {k:02d}",
                "email": f"consultor{k:02d}@ficticia.teste",
                "papel": "atendente",
                "mid": IDS["cons"][k - 1],
                "k": k,
            }
            for k in range(1, 51)
        ]
        personas += [
            {
                "nome": f"Gestora {k}",
                "email": f"gestora{k}@ficticia.teste",
                "papel": "admin",
                "mid": IDS["gest"][k - 1],
                "k": 0,
            }
            for k in range(1, 6)
        ]
        t0 = time.monotonic()
        for p in personas:
            p["token"] = await entrar(cli, p["email"])
        print(f"login das {len(personas)} pessoas pela tela de entrar: {time.monotonic() - t0:.1f}s", flush=True)

        relatorio = {"fases": {}}
        for vus in (10, 25, 50, 100, 200):
            placar = Placar()
            prazo = time.monotonic() + SEG
            escolhidos = [
                random.choices(personas, weights=[1 if p["papel"] != "atendente" else 9 for p in personas])[0]
                for _ in range(vus)
            ]
            await asyncio.gather(*(usuario(cli, p, convs, prazo, placar) for p in escolhidos))
            res = placar.resumo(SEG)
            relatorio["fases"][vus] = res
            print(
                f"{vus:>3} simultâneos: {res['pedidos']} pedidos, {res['por_seg']}/s, p50 {res['p50_ms']}ms, p95 {res['p95_ms']}ms, "
                f"p99 {res['p99_ms']}ms, 5xx {res['erros_5xx']}, timeouts {res['timeouts']}, VIOLAÇÕES {res['violacoes']}",
                flush=True,
            )
            for v in placar.violacoes[:10]:
                print("   !!", v, flush=True)

        # caos: cargos trocando e gente sendo desligada enquanto 50 usam
        estado = Estado()
        estado._base = {p["mid"]: p["papel"] for p in personas if p["mid"]}
        placar = Placar()
        prazo = time.monotonic() + SEG * 2
        consultores = [p for p in personas if p["papel"] == "atendente"]
        escolhidos = random.choices(consultores, k=50)
        resultado = await asyncio.gather(
            caos(pg, estado, personas, prazo), *(usuario(cli, p, convs, prazo, placar, estado) for p in escolhidos)
        )
        res = placar.resumo(SEG * 2)
        res["trocas_de_cargo"] = resultado[0]
        relatorio["caos"] = res
        print(
            f"CAOS (50 simultâneos, {resultado[0]} trocas de cargo/desligamentos): {res['pedidos']} pedidos, p95 {res['p95_ms']}ms, "
            f"5xx {res['erros_5xx']}, VIOLAÇÕES {res['violacoes']}",
            flush=True,
        )
        for v in placar.violacoes[:10]:
            print("   !!", v, flush=True)
        await pg.execute(
            "UPDATE ta_member SET role='atendente', status='active' WHERE id = ANY($1::int[])", IDS["cons"]
        )
        with open(sys.argv[2].replace("carga_ids.json", "carga_relatorio.json"), "w") as f:
            json.dump(relatorio, f, indent=1, default=str)
    await pg.close()


asyncio.run(main())
