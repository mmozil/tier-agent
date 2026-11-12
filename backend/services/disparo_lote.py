"""Disparo em lote pela tela do Agent — WhatsApp OFICIAL (Cloud API), 11/11/2026.

A página «Disparos»: um modelo APROVADO, por um número oficial, para uma lista colada, com cada
variável do modelo vindo da lista (primeiro nome do contato) ou de um texto fixo.

Cada contato sai pelo MESMO caminho do disparo do ERP (`disparo_oficial.enviar_modelo`): o modelo
entra na conversa do contato naquele número, o wamid nasce `accepted` em `ta_wa_envio_status` e o
erro 131050 põe o contato na lista de descadastro do tenant.

Regras herdadas do disparo do ERP (tier-finance `services/disparos_service.py` +
`disparos_worker.py`, publicado em d1c41dd), que custaram incidente lá:
- UM worker (`processar_disparos_job`, a cada `TICK_S`). Ele roda nos 2 workers do uvicorn e, no
  deploy do Coolify, nos dois contêineres por alguns segundos — por isso a trava é NO BANCO:
    a) a VEZ do disparo: UPDATE condicional em `proximo_envio_em` — só um processo ganha, e o
       mesmo campo carrega o ritmo (intervalo ± variação);
    b) o contato: SELECT … FOR UPDATE SKIP LOCKED + troca para `enviando`.
- Envio preso em `enviando` (o processo morreu no meio) volta à fila em `ENVIO_TRAVADO_APOS`;
  depois de `MAX_TENTATIVAS` reservas vira falha. 🚨 Se o processo morreu DEPOIS de a Meta aceitar
  e ANTES de gravar, o contato recebe de novo — «pode duplicar» é melhor que «some em silêncio».
- Pausa automática: erro do NÚMERO/CONTA (`conta=true`) pausa com o motivo e o contato volta para a
  fila; ≥ `MIN_PARA_TAXA` processados desde o último iniciar/retomar com mais de
  `TAXA_FALHA_MAXIMA` de falha também pausa. Descadastrado e «sem nome» não entram na conta.
- Entrega/leitura vêm de `ta_wa_envio_status` (o webhook grava sem regredir). Os números do
  disparo são CONTADOS das linhas na hora — não há contador somado em Python para perder soma.
- A transação é fechada ANTES da chamada à Meta (nada de «idle in transaction» durante o HTTP).
"""

from __future__ import annotations

import json
import logging
import random
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, func, insert, or_, select, update

from models import (
    TaAgent,
    TaConnector,
    TaDisparoOficial,
    TaDisparoOficialEnvio,
    TaMessageLog,
    TaWaDescadastro,
    TaWaEnvioStatus,
)
from routes.whatsapp_oficial import STATUS_PT, numero_do_contato, resumo_do_modelo
from services import disparo_oficial

logger = logging.getLogger(__name__)

D = TaDisparoOficial
E = TaDisparoOficialEnvio

# ───────────────────────── limites ─────────────────────────

LIMITE_CONTATOS = 5000
INTERVALO_PADRAO_S = 8
INTERVALO_MIN_S = 2
INTERVALO_MAX_S = 300
VARIACAO_FRACAO = 0.25  # o intervalo varia ± 25 % (ritmo regular demais é padrão de robô)
AGENDAR_ATE = timedelta(days=60)
TEXTO_FIXO_MAX = 1000

TICK_S = 2  # o worker olha a fila a cada 2 s; intervalo mínimo de 2 s → na prática 2 a 4 s
MAX_DISPAROS_POR_TICK = 20
VEZ_TRAVADA_POR = timedelta(minutes=3)  # > a chamada mais lenta (30 s); processo morto libera sozinho
ENVIO_TRAVADO_APOS = timedelta(minutes=10)
MAX_TENTATIVAS = 3
MIN_PARA_TAXA = 20
TAXA_FALHA_MAXIMA = 0.30

# ───────────────────────── estados ─────────────────────────

RASCUNHO = "rascunho"
EM_ANDAMENTO = "em_andamento"
PAUSADO = "pausado"
CONCLUIDO = "concluido"
CANCELADO = "cancelado"

PENDENTE = "pendente"
ENVIANDO = "enviando"
ENVIADO = "enviado"
FALHOU = "falhou"
DESCADASTRADO = "descadastrado"
SEM_NOME = "sem_nome"
ENVIO_CANCELADO = "cancelado"

MOTIVO_DESCADASTRO = "O contato pediu para não receber mensagens"
MOTIVO_131050 = "O contato parou de receber marketing desta empresa no WhatsApp (Meta 131050)"
MOTIVO_SEM_NOME = "A lista não trouxe o nome, e o modelo usa o nome"
MOTIVO_CANCELADO = "O disparo foi cancelado antes deste envio"


def _agora() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# ───────────────────────── leitura da lista (regra pura) ─────────────────────────

_SEPARADOR = re.compile(r"[	;,|]")
# Pedaço que só tem dígito e pontuação de telefone: «+55», «(11)», «98765-4321». Data («10/11/2026»)
# tem barra e NÃO é — assim ela separa o ano do telefone em vez de grudar nele.
_PEDACO_TEL = re.compile(r"^[+(]*\d[\d().\-]*$")
_LETRA_DIGITO = re.compile(r"(?<=[^\W\d_])(?=[+(\d])|(?<=\d)(?=[^\W\d_])")
_TRATAMENTOS = frozenset({"sr", "sra", "srta", "dr", "dra", "prof", "profa", "professor", "professora"})


@dataclass
class Contato:
    numero: str
    chave: str
    nome: str | None


@dataclass
class Leitura:
    contatos: list[Contato] = field(default_factory=list)
    invalidas: list[dict] = field(default_factory=list)  # {"linha": n, "texto": "…", "motivo": "…"}
    duplicados: int = 0


def numero_valido(trecho: str) -> str | None:
    """O número com DDI, ou None. Sem «+» só vale formato do Brasil (DDD + número, com ou sem o
    55, com ou sem o 0 de interurbano) — normalizado por `numero_do_contato`. Com «+» na frente,
    número de outro país (10 a 15 dígitos) entra como veio."""
    com_mais = trecho.strip().startswith("+")
    d = re.sub(r"\D", "", trecho or "")
    if com_mais and not d.startswith("55"):
        return d if 10 <= len(d) <= 15 else None
    d = d.lstrip("0")
    if len(d) in (10, 11) or (len(d) in (12, 13) and d.startswith("55")):
        try:
            return numero_do_contato(d)
        except ValueError:
            return None
    return None


def _achar_numero(pedacos: list[str]) -> tuple[str | None, set[int]]:
    """Procura o telefone nas sequências de pedaços-de-telefone, da janela mais longa para a
    mais curta («2026 11987654321»: a junção dá 15 dígitos e não vale; o «11987654321» vale)."""
    corridas: list[list[int]] = []
    atual: list[int] = []
    for i, p in enumerate(pedacos):
        if _PEDACO_TEL.match(p):
            atual.append(i)
        elif atual:
            corridas.append(atual)
            atual = []
    if atual:
        corridas.append(atual)
    for corrida in corridas:
        for tam in range(len(corrida), 0, -1):
            for ini in range(0, len(corrida) - tam + 1):
                janela = corrida[ini : ini + tam]
                n = numero_valido(" ".join(pedacos[i] for i in janela))
                if n:
                    return n, set(janela)
    return None, set()


def _limpar_nome(trecho: str) -> str | None:
    if not trecho or "@" in trecho:  # e-mail não é nome
        return None
    s = re.sub(r"[^\w\s'’-]|[\d_]", " ", trecho)
    s = re.sub(r"\s+", " ", s).strip(" -'’")
    return s[:120] if sum(ch.isalpha() for ch in s) >= 2 else None


def ler_linha(linha: str) -> tuple[str | None, str | None, str | None]:
    """(número, nome, motivo de inválida). Aceita «Maria Silva 11 98765-4321», linha de planilha
    (TAB, `;`, `,` ou `|` entre as colunas) e só o número. O nome é o primeiro pedaço com letras."""
    celulas = [c.strip() for c in _SEPARADOR.split(linha)] if _SEPARADOR.search(linha) else [linha.strip()]
    numero = nome = None
    for celula in celulas:
        pedacos = _LETRA_DIGITO.sub(" ", re.sub(r"[:=]", " ", celula)).split()
        usados: set[int] = set()
        if numero is None:
            numero, usados = _achar_numero(pedacos)
        if nome is None:
            nome = _limpar_nome(" ".join(p for i, p in enumerate(pedacos) if i not in usados))
    if numero:
        return numero, nome, None
    return None, None, ("número inválido" if re.search(r"\d", linha) else "sem número")


def ler_lista(texto: str) -> Leitura:
    """Uma linha por contato. Duplicado = mesma pessoa pela chave tolerante ao 9º dígito (a mesma
    do descadastro): `5511987654321` e `551187654321` saem uma vez só. A 1ª ocorrência vence; se
    ela veio sem nome e a repetida tem, o nome é aproveitado."""
    out = Leitura()
    por_chave: dict[str, Contato] = {}
    for i, bruta in enumerate((texto or "").splitlines(), start=1):
        linha = bruta.strip()
        if not linha:
            continue
        numero, nome, motivo = ler_linha(linha)
        if not numero:
            out.invalidas.append({"linha": i, "texto": linha[:80], "motivo": motivo})
            continue
        chave = disparo_oficial.chave_tolerante(numero)
        if chave in por_chave:
            out.duplicados += 1
            if nome and not por_chave[chave].nome:
                por_chave[chave].nome = nome
            continue
        c = Contato(numero=numero, chave=chave, nome=nome)
        por_chave[chave] = c
        out.contatos.append(c)
    return out


def primeiro_nome(nome: str | None) -> str | None:
    """«MARIA DA SILVA» → «Maria»; «dr. joão» → «João». Só a primeira palavra (o modelo diz
    «Olá {{1}}», não «Olá Maria da Silva Santos»)."""
    for palavra in (nome or "").split():
        if palavra.lower().strip(".") in _TRATAMENTOS:
            continue
        if sum(ch.isalpha() for ch in palavra) < 2:
            continue
        if palavra.isupper() or palavra.islower():
            palavra = "-".join(p[:1].upper() + p[1:].lower() for p in palavra.split("-"))
        return palavra[:60]
    return None


# ───────────────────────── modelo e variáveis (regra pura) ─────────────────────────

_NOMEADA = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
_BOTOES_SEM_PARAMETRO = frozenset({"QUICK_REPLY", "PHONE_NUMBER", "URL", "VOICE_CALL"})


def bloqueio_do_modelo(t: dict) -> str | None:
    """Por que este modelo (como a Meta devolve) não pode ir num disparo daqui — ou None.

    Este disparo só preenche as variáveis {{1}}, {{2}}… do TEXTO. Modelo que pede outro parâmetro
    (mídia no topo, variável no título, link variável no botão, cupom…) seria recusado pela Meta
    em TODOS os contatos; melhor dizer antes de começar."""
    status = str(t.get("status") or "").upper()
    if status != "APPROVED":
        return f"O modelo está «{STATUS_PT.get(status, status.title() or 'sem status')}» — só modelo aprovado pode ser disparado"
    if str(t.get("category") or "").upper() == "AUTHENTICATION":
        return "Modelo de autenticação (código de acesso) não é para disparo"
    for c in t.get("components") or []:
        tipo = str(c.get("type") or "").upper()
        if tipo == "HEADER":
            if str(c.get("format") or "").upper() != "TEXT":
                return "Modelo com imagem, vídeo ou documento no topo ainda não é disparado por aqui"
            if "{{" in (c.get("text") or ""):
                return "Modelo com variável no título ainda não é disparado por aqui"
        elif tipo == "BODY":
            if _NOMEADA.search(c.get("text") or ""):
                return "Modelo com variável por nome ({{nome}}) ainda não é disparado por aqui — use {{1}}, {{2}}…"
        elif tipo == "BUTTONS":
            for b in c.get("buttons") or []:
                bt = str(b.get("type") or "").upper()
                if bt not in _BOTOES_SEM_PARAMETRO:
                    return f"Modelo com botão do tipo {bt or '?'} ainda não é disparado por aqui"
                if bt == "URL" and "{{" in (b.get("url") or ""):
                    return "Modelo com link variável no botão ainda não é disparado por aqui"
        elif tipo != "FOOTER":
            return f"Modelo com {tipo.lower() or 'componente desconhecido'} ainda não é disparado por aqui"
    return None


def validar_variaveis(variaveis: list[dict] | None, quantas: int) -> list[dict]:
    """Uma fonte por {{n}}: `{"fonte": "nome"}` ou `{"fonte": "fixo", "valor": "…"}`."""
    variaveis = list(variaveis or [])
    if len(variaveis) != quantas:
        raise ValueError(f"O modelo tem {quantas} variáve{'l' if quantas == 1 else 'is'} — defina de onde vem cada uma")
    out = []
    for i, v in enumerate(variaveis, start=1):
        fonte = str((v or {}).get("fonte") or "")
        if fonte == "nome":
            out.append({"fonte": "nome"})
            continue
        if fonte != "fixo":
            raise ValueError(f"{{{{{i}}}}}: escolha «primeiro nome da lista» ou «texto fixo»")
        valor = str((v or {}).get("valor") or "").strip()
        if not valor:
            raise ValueError(f"{{{{{i}}}}}: escreva o texto fixo")
        if len(valor) > TEXTO_FIXO_MAX:
            raise ValueError(f"{{{{{i}}}}}: o texto passa de {TEXTO_FIXO_MAX} caracteres")
        # A Meta recusa parâmetro com quebra de linha, TAB ou mais de 4 espaços seguidos (132018).
        if re.search(r"[\n\r\t]| {5,}", valor):
            raise ValueError(f"{{{{{i}}}}}: o texto não pode ter quebra de linha, TAB ou muitos espaços seguidos")
        out.append({"fonte": "fixo", "valor": valor})
    return out


def usa_nome(variaveis: list[dict] | None) -> bool:
    return any((v or {}).get("fonte") == "nome" for v in variaveis or [])


def valores_do_contato(variaveis: list[dict] | None, nome: str | None) -> list[str] | None:
    """Os valores de {{1}}, {{2}}… para este contato. None = o modelo pede o nome e a lista não
    trouxe — o contato fica «sem nome» e não recebe (não inventamos um nome)."""
    primeiro = primeiro_nome(nome)
    out = []
    for v in variaveis or []:
        if v.get("fonte") == "nome":
            if not primeiro:
                return None
            out.append(primeiro)
        else:
            out.append(str(v.get("valor") or ""))
    return out


def componentes(valores: list[str] | None) -> list | None:
    return [{"type": "body", "parameters": [{"type": "text", "text": v} for v in valores]}] if valores else None


def intervalo_valido(intervalo_s) -> int:
    try:
        s = int(intervalo_s)
    except (TypeError, ValueError):
        s = INTERVALO_PADRAO_S
    if s < INTERVALO_MIN_S:
        raise ValueError(f"O intervalo mínimo entre envios é de {INTERVALO_MIN_S} segundos")
    if s > INTERVALO_MAX_S:
        raise ValueError(f"O intervalo máximo entre envios é de {INTERVALO_MAX_S} segundos")
    return s


def proximo_horario(intervalo_ms: int, variacao_ms: int, agora: datetime | None = None) -> datetime:
    """agora + intervalo ± variação, nunca abaixo do mínimo."""
    base = int(intervalo_ms or INTERVALO_PADRAO_S * 1000)
    var = int(variacao_ms or 0)
    if var > 0:
        base += random.randint(-var, var)
    return (agora or _agora()) + timedelta(milliseconds=max(INTERVALO_MIN_S * 1000, base))


# ───────────────────────── situação e contagens (regra pura) ─────────────────────────

_META = {"delivered": "entregue", "read": "lido", "failed": "falhou"}


def situacao(status_envio: str, status_meta: str | None) -> str:
    """O que a tela mostra do contato. Depois de enviado, quem manda é a Meta (sem regredir: o
    `ta_wa_envio_status` só avança)."""
    if status_envio == ENVIADO:
        return _META.get((status_meta or "").lower(), "enviado")
    return status_envio


def contar(linhas) -> dict:
    """`linhas` = (status do envio, status da Meta, quantidade). Enviados incluem entregues e
    lidos (funil); falha tardia (a Meta aceitou e depois não entregou) é falha, não enviado."""
    c = dict.fromkeys(
        ("pendentes", "enviados", "entregues", "lidos", "falhas", "descadastrados", "sem_nome", "cancelados"), 0
    )
    for st, meta, n in linhas:
        s = situacao(st, meta)
        n = int(n or 0)
        if s in (PENDENTE, ENVIANDO):
            c["pendentes"] += n
        elif s in ("enviado", "entregue", "lido"):
            c["enviados"] += n
            if s != "enviado":
                c["entregues"] += n
            if s == "lido":
                c["lidos"] += n
        elif s == FALHOU:
            c["falhas"] += n
        elif s == DESCADASTRADO:
            c["descadastrados"] += n
        elif s == SEM_NOME:
            c["sem_nome"] += n
        elif s == ENVIO_CANCELADO:
            c["cancelados"] += n
    return c


def taxa_estourou(enviados: int, falhas: int) -> bool:
    base = max(0, enviados) + max(0, falhas)
    return base >= MIN_PARA_TAXA and falhas / base > TAXA_FALHA_MAXIMA


# ───────────────────────── banco: leitura ─────────────────────────


async def contagens(db, ids: list[int]) -> dict[int, dict]:
    ids = [int(i) for i in ids or []]
    if not ids:
        return {}
    S = TaWaEnvioStatus
    rows = (
        await db.execute(
            select(E.disparo_id, E.status, S.status, func.count())
            .select_from(E)
            .outerjoin(S, S.wamid == E.wamid)
            .where(E.disparo_id.in_(ids))
            .group_by(E.disparo_id, E.status, S.status)
        )
    ).all()
    por: dict[int, list] = {i: [] for i in ids}
    for did, st, meta, n in rows:
        por.setdefault(did, []).append((st, meta, n))
    resp = await respondidos(db, ids)
    return {did: {**contar(linhas), "respondidos": resp.get(did, 0)} for did, linhas in por.items()}


def respondeu():
    """Condição «o contato respondeu»: mensagem DELE na conversa do envio, depois do envio
    (12/11/2026). Vale qualquer resposta — texto, áudio, botão do modelo. A conversa é a do
    número oficial (`E.conversation_id`), então resposta noutro número não conta."""
    M = TaMessageLog
    return (
        E.conversation_id.isnot(None)
        & E.enviado_em.isnot(None)
        & exists().where(M.conversation_id == E.conversation_id, M.role == "user", M.created_at > E.enviado_em)
    )


def primeira_resposta():
    """Quando o contato respondeu pela primeira vez depois do envio (subconsulta por envio)."""
    M = TaMessageLog
    return (
        select(func.min(M.created_at))
        .where(M.conversation_id == E.conversation_id, M.role == "user", M.created_at > E.enviado_em)
        .correlate(E)
        .scalar_subquery()
    )


async def respondidos(db, ids: list[int]) -> dict[int, int]:
    """{disparo: quantos contatos responderam}."""
    ids = [int(i) for i in ids or []]
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(E.disparo_id, func.count()).where(E.disparo_id.in_(ids), respondeu()).group_by(E.disparo_id)
        )
    ).all()
    return {int(did): int(n) for did, n in rows}


async def descadastrados_da_lista(db, tenant_id: int, chaves: list[str]) -> set[str]:
    """Quais destas chaves estão na lista de descadastro do tenant (consulta em blocos)."""
    achadas: set[str] = set()
    chaves = list(dict.fromkeys(chaves))
    for i in range(0, len(chaves), 1000):
        bloco = chaves[i : i + 1000]
        achadas.update(
            (
                await db.execute(
                    select(TaWaDescadastro.chave).where(
                        TaWaDescadastro.tenant_id == tenant_id, TaWaDescadastro.chave.in_(bloco)
                    )
                )
            )
            .scalars()
            .all()
        )
    return achadas


# ───────────────────────── banco: criar e ciclo ─────────────────────────


class ErroDoDisparo(ValueError):
    """Pedido que não pode ser feito (a rota devolve 409 ou 422 com o texto)."""

    def __init__(self, mensagem: str, http: int = 422):
        super().__init__(mensagem)
        self.http = http


async def criar(
    db,
    *,
    tenant_id: int,
    connector_id: int,
    modelo_meta: dict,
    variaveis: list[dict] | None,
    lista: str,
    nome: str | None = None,
    intervalo_s: int | None = None,
    agendar_para: datetime | None = None,
    criado_por_member_id: int | None = None,
    criado_por: str | None = None,
) -> TaDisparoOficial:
    """Cria o disparo em RASCUNHO com um envio por contato. Nada sai até `iniciar`.
    `modelo_meta` = o modelo como a Meta devolve (para conferir o que o disparo consegue mandar)."""
    motivo = bloqueio_do_modelo(modelo_meta)
    if motivo:
        raise ErroDoDisparo(motivo)
    resumo = resumo_do_modelo(modelo_meta)
    try:
        vars_ok = validar_variaveis(variaveis, int(resumo.get("variaveis") or 0))
        intervalo = intervalo_valido(INTERVALO_PADRAO_S if intervalo_s is None else intervalo_s)
    except ValueError as e:
        raise ErroDoDisparo(str(e)) from e
    agora = _agora()
    if agendar_para is not None:
        if agendar_para.tzinfo is not None:
            agendar_para = agendar_para.astimezone(UTC).replace(tzinfo=None)
        if agendar_para < agora - timedelta(minutes=1):
            raise ErroDoDisparo("O horário agendado já passou")
        if agendar_para > agora + AGENDAR_ATE:
            raise ErroDoDisparo("Agende para no máximo 60 dias à frente")
    leitura = ler_lista(lista)
    if not leitura.contatos:
        raise ErroDoDisparo("A lista não tem nenhum número válido")
    if len(leitura.contatos) > LIMITE_CONTATOS:
        raise ErroDoDisparo(
            f"A lista tem {len(leitura.contatos):,} contatos; o limite por disparo é {LIMITE_CONTATOS:,}".replace(
                ",", "."
            )
        )
    precisa_nome = usa_nome(vars_ok)
    titulo = (nome or "").strip()[:120] or f"{resumo.get('nome')} · {agora:%d/%m %H:%M}"
    d = TaDisparoOficial(
        tenant_id=tenant_id,
        connector_id=connector_id,
        nome=titulo,
        modelo=str(resumo.get("nome") or "")[:512],
        idioma=str(resumo.get("idioma") or "pt_BR")[:16],
        categoria=(str(resumo.get("categoria") or "")[:32] or None),
        modelo_json=resumo,
        variaveis_json=vars_ok,
        intervalo_ms=intervalo * 1000,
        variacao_ms=int(intervalo * 1000 * VARIACAO_FRACAO),
        agendado_para=agendar_para,
        status=RASCUNHO,
        total=len(leitura.contatos),
        criado_por_member_id=criado_por_member_id,
        criado_por=(criado_por or "")[:120] or None,
        criado_em=agora,
    )
    # Quem já pediu para não receber fica marcado desde já (a conta de custo da tela bate) — e o
    # worker confere de novo na hora de cada envio, para quem pedir depois de criado.
    fora = await descadastrados_da_lista(db, tenant_id, [c.chave for c in leitura.contatos])
    db.add(d)
    await db.flush()

    def _estado(c: Contato) -> tuple[str, str | None]:
        if c.chave in fora:
            return DESCADASTRADO, MOTIVO_DESCADASTRO
        if precisa_nome and not primeiro_nome(c.nome):
            return SEM_NOME, MOTIVO_SEM_NOME
        return PENDENTE, None

    linhas = []
    for c in leitura.contatos:
        st, motivo = _estado(c)
        linhas.append(
            {
                "disparo_id": d.id,
                "numero": c.numero,
                "chave": c.chave[:32],
                "nome": c.nome,
                "status": st,
                "erro": motivo,
                "tentativas": 0,
            }
        )
    for i in range(0, len(linhas), 1000):
        await db.execute(insert(E), linhas[i : i + 1000])
    await db.commit()
    return d


async def _regua(db, did: int) -> dict:
    c = (await contagens(db, [did]))[did]
    return {"taxa_base_enviados": c["enviados"], "taxa_base_falhas": c["falhas"]}


async def iniciar(db, did: int) -> None:
    agora = _agora()
    pendentes = (
        await db.execute(select(func.count()).select_from(E).where(E.disparo_id == did, E.status == PENDENTE))
    ).scalar() or 0
    if not pendentes:
        raise ErroDoDisparo("Nenhum contato para enviar (todos sem nome ou fora da lista)", 409)
    d = await db.get(D, did, populate_existing=True)
    comeca = d.agendado_para if d and d.agendado_para and d.agendado_para > agora else None
    r = await db.execute(
        update(D)
        .where(D.id == did, D.status == RASCUNHO)
        .values(
            status=EM_ANDAMENTO,
            iniciado_em=agora,
            motivo_pausa=None,
            proximo_envio_em=comeca,
            taxa_base_enviados=0,
            taxa_base_falhas=0,
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if (r.rowcount or 0) != 1:
        raise ErroDoDisparo("Só um rascunho pode ser iniciado", 409)


async def pausar(db, did: int, quem: str | None = None) -> None:
    r = await db.execute(
        update(D)
        .where(D.id == did, D.status == EM_ANDAMENTO)
        .values(status=PAUSADO, pausado_em=_agora(), motivo_pausa=(f"Pausado por {quem}" if quem else "Pausado")[:500])
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if (r.rowcount or 0) != 1:
        raise ErroDoDisparo("Só um disparo em andamento pode ser pausado", 409)


async def retomar(db, did: int) -> None:
    agora = _agora()
    d = await db.get(D, did, populate_existing=True)
    valores = {"status": EM_ANDAMENTO, "pausado_em": None, "motivo_pausa": None, **(await _regua(db, did))}
    if d and d.agendado_para and d.agendado_para > agora:
        valores["proximo_envio_em"] = d.agendado_para
    # Sem agendamento futuro a VEZ fica como está: um envio ainda em curso a devolve sozinho.
    r = await db.execute(
        update(D).where(D.id == did, D.status == PAUSADO).values(**valores).execution_options(synchronize_session=False)
    )
    await db.commit()
    if (r.rowcount or 0) != 1:
        raise ErroDoDisparo("Só um disparo pausado pode ser retomado", 409)


async def cancelar(db, did: int) -> None:
    """Idempotente. Os pendentes viram «cancelado»; o envio em curso de verdade termina e grava
    sozinho; o preso por processo morto também sai."""
    agora = _agora()
    await db.execute(
        update(D)
        .where(D.id == did, D.status.in_((RASCUNHO, EM_ANDAMENTO, PAUSADO)))
        .values(status=CANCELADO, cancelado_em=agora)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(E)
        .where(E.disparo_id == did, E.status == PENDENTE)
        .values(status=ENVIO_CANCELADO, erro=MOTIVO_CANCELADO)
        .execution_options(synchronize_session=False)
    )
    await db.execute(
        update(E)
        .where(
            E.disparo_id == did,
            E.status == ENVIANDO,
            or_(E.reservado_em.is_(None), E.reservado_em < agora - ENVIO_TRAVADO_APOS),
        )
        .values(status=ENVIO_CANCELADO, erro=MOTIVO_CANCELADO, reservado_em=None)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def excluir_rascunho(db, did: int) -> None:
    """Só rascunho. O DELETE do disparo é condicional (status no BANCO, não o da memória) e os
    contatos só saem se ele saiu — tudo na mesma transação."""
    r = await db.execute(
        delete(D).where(D.id == did, D.status == RASCUNHO).execution_options(synchronize_session=False)
    )
    if (r.rowcount or 0) != 1:
        await db.rollback()
        raise ErroDoDisparo("Só rascunho pode ser apagado — disparo iniciado fica no histórico", 409)
    await db.execute(delete(E).where(E.disparo_id == did).execution_options(synchronize_session=False))
    await db.commit()


# ───────────────────────── worker: travas ─────────────────────────


async def reservar_vez(db, did: int, agora: datetime) -> bool:
    """A VEZ de enviar o próximo contato deste disparo — atômico entre processos. Só passa se o
    disparo está em andamento e `proximo_envio_em` chegou; fica presa por `VEZ_TRAVADA_POR` até
    `liberar_vez` gravar o próximo horário (no Postgres o 2º UPDATE reavalia o WHERE: 0 linhas)."""
    r = await db.execute(
        update(D)
        .where(D.id == did, D.status == EM_ANDAMENTO, or_(D.proximo_envio_em.is_(None), D.proximo_envio_em <= agora))
        .values(proximo_envio_em=agora + VEZ_TRAVADA_POR)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return (r.rowcount or 0) == 1


async def liberar_vez(db, did: int, proximo: datetime | None) -> None:
    await db.execute(
        update(D).where(D.id == did).values(proximo_envio_em=proximo).execution_options(synchronize_session=False)
    )
    await db.commit()


async def reservar_envio(db, did: int, agora: datetime):
    """Trava o próximo pendente (SKIP LOCKED: o outro processo pula, nunca pega o mesmo contato),
    troca para `enviando` e grava. No SQLite dos testes o FOR UPDATE some sozinho."""
    envio = (
        (
            await db.execute(
                select(E)
                .where(E.disparo_id == did, E.status == PENDENTE)
                .order_by(E.id)
                .limit(1)
                .with_for_update(skip_locked=True)
                # o estado do BANCO, não o da memória da sessão (os UPDATEs em lote não a sincronizam)
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .first()
    )
    if envio is None:
        await db.commit()
        return None
    envio.status = ENVIANDO
    envio.reservado_em = agora
    envio.tentativas = (envio.tentativas or 0) + 1
    await db.commit()
    return envio


async def devolver_travados(db, did: int, agora: datetime) -> int:
    limite = agora - ENVIO_TRAVADO_APOS
    preso = (E.disparo_id == did, E.status == ENVIANDO, or_(E.reservado_em.is_(None), E.reservado_em < limite))
    r1 = await db.execute(
        update(E)
        .where(*preso, E.tentativas >= MAX_TENTATIVAS)
        .values(
            status=FALHOU,
            reservado_em=None,
            erro=f"Envio interrompido {MAX_TENTATIVAS} vezes sem resposta — não foi tentado de novo",
        )
        .execution_options(synchronize_session=False)
    )
    r2 = await db.execute(
        update(E).where(*preso).values(status=PENDENTE, reservado_em=None).execution_options(synchronize_session=False)
    )
    await db.commit()
    n = (r1.rowcount or 0) + (r2.rowcount or 0)
    if n:
        logger.warning("disparo em lote %s: %s envio(s) presos voltaram (%s viraram falha)", did, n, r1.rowcount or 0)
    return n


async def _devolver_para_fila(db, envio) -> None:
    """O contato não chegou a ser tentado de verdade (o problema é do número): volta para a fila
    sem gastar tentativa."""
    envio.status = PENDENTE
    envio.reservado_em = None
    envio.tentativas = max(0, (envio.tentativas or 0) - 1)
    await db.commit()


async def pausar_por_motivo(db, did: int, motivo: str) -> bool:
    """Pausa com o motivo — só se ainda estiver em andamento (não atropela quem pausou/cancelou)."""
    r = await db.execute(
        update(D)
        .where(D.id == did, D.status == EM_ANDAMENTO)
        .values(status=PAUSADO, pausado_em=_agora(), motivo_pausa=motivo[:500])
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if r.rowcount:
        logger.warning("disparo em lote %s pausado: %s", did, motivo)
    return (r.rowcount or 0) == 1


async def pausar_se_taxa(db, did: int) -> bool:
    base = (await db.execute(select(D.taxa_base_enviados, D.taxa_base_falhas).where(D.id == did))).first()
    if not base:
        return False
    c = (await contagens(db, [did]))[did]
    await db.commit()
    enviados = max(0, c["enviados"] - (base[0] or 0))
    falhas = max(0, c["falhas"] - (base[1] or 0))
    if not taxa_estourou(enviados, falhas):
        return False
    return await pausar_por_motivo(
        db, did, f"Muitas falhas ({falhas} de {enviados + falhas}) — confira a lista antes de continuar"
    )


async def finalizar_se_concluido(db, did: int) -> bool:
    abertos = (
        await db.execute(
            select(func.count()).select_from(E).where(E.disparo_id == did, E.status.in_((PENDENTE, ENVIANDO)))
        )
    ).scalar() or 0
    if abertos:
        await db.commit()
        return False
    r = await db.execute(
        update(D)
        .where(D.id == did, D.status == EM_ANDAMENTO)
        .values(status=CONCLUIDO, concluido_em=_agora())
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return (r.rowcount or 0) == 1


# ───────────────────────── worker: um envio ─────────────────────────


async def _numero_do_disparo(db, d) -> tuple[object | None, dict | None, str | None]:
    """(conector, config decifrada, motivo para pausar). O número tem de seguir oficial, ligado e
    do mesmo tenant — se alguém o desconectou no meio, o disparo pausa em vez de queimar a lista."""
    from core.encryption import decrypt

    conn = await db.get(TaConnector, d.connector_id)
    agente = await db.get(TaAgent, conn.agent_id) if conn else None
    if not conn or not agente or agente.tenant_id != d.tenant_id or conn.kind != "whatsapp_cloud":
        return None, None, "O número oficial deste disparo não existe mais"
    if not conn.enabled:
        return None, None, "O número oficial está desconectado — reconecte em Canais e retome o disparo"
    try:
        cfg = json.loads(decrypt(conn.config_json_enc))
    except Exception:  # noqa: BLE001
        return None, None, "Não consegui ler a configuração do número oficial — refaça o cadastro em Canais"
    return conn, cfg, None


async def processar_um(db, did: int, agora: datetime | None = None) -> str:
    """Um passo do disparo: no máximo UM contato. Devolve o que aconteceu (para log e teste)."""
    from services.connectors.registry import registry

    agora = agora or _agora()
    await devolver_travados(db, did, agora)
    if not await reservar_vez(db, did, agora):
        return "nao_e_a_vez"
    envio = await reservar_envio(db, did, agora)
    if envio is None:
        await liberar_vez(db, did, None)
        await finalizar_se_concluido(db, did)
        return "sem_pendentes"

    d = await db.get(D, did, populate_existing=True)
    if d is None or d.status != EM_ANDAMENTO:
        # Pausado/cancelado entre pegar a vez e reservar o contato: ele não sai.
        if d is not None and d.status == CANCELADO:
            envio.status, envio.erro, envio.reservado_em = ENVIO_CANCELADO, MOTIVO_CANCELADO, None
            await db.commit()
        else:
            await _devolver_para_fila(db, envio)
        await liberar_vez(db, did, None)
        return "parou_no_meio"

    conn, cfg, motivo = await _numero_do_disparo(db, d)
    if motivo:
        await _devolver_para_fila(db, envio)
        await pausar_por_motivo(db, did, motivo)
        await liberar_vez(db, did, None)
        return "pausou_numero"

    if await disparo_oficial.esta_descadastrado(db, d.tenant_id, envio.numero):
        envio.status, envio.erro, envio.reservado_em = DESCADASTRADO, MOTIVO_DESCADASTRO, None
        await db.commit()
        await liberar_vez(db, did, None)  # nada saiu: o próximo pode ir já
        await finalizar_se_concluido(db, did)
        return "descadastrado"

    valores = valores_do_contato(d.variaveis_json, envio.nome)
    if valores is None:  # a criação já marca; isto é só a rede de segurança
        envio.status, envio.erro, envio.reservado_em = SEM_NOME, MOTIVO_SEM_NOME, None
        await db.commit()
        await liberar_vez(db, did, None)
        await finalizar_se_concluido(db, did)
        return "sem_nome"

    # Tudo o que o envio precisa sai do banco ANTES do HTTP, e a transação fecha aqui.
    tenant_id, modelo, idioma, resumo = d.tenant_id, d.modelo, d.idioma, d.modelo_json
    intervalo_ms, variacao_ms = d.intervalo_ms, d.variacao_ms
    numero, nome = envio.numero, envio.nome
    await db.commit()

    try:
        res = await disparo_oficial.enviar_modelo(
            db,
            tenant_id=tenant_id,
            conn=conn,
            cfg=cfg,
            impl=registry.get("whatsapp_cloud"),
            to=numero,
            template_name=modelo,
            lang=idioma,
            components=componentes(valores),
            modelo=resumo,
            contact_name=nome,
        )
    except disparo_oficial.ErroDeEnvio as e:
        det = e.detalhe
        codigo = det.get("meta_code")
        texto = str(det.get("mensagem") or "erro da Meta")
        sufixo = f" (código {codigo})" if codigo not in (None, "") else ""
        if det.get("conta"):
            # Do número/conta (ou do modelo inteiro): todo contato seguinte falharia igual.
            envio.erro = f"{texto}{sufixo}"[:500]
            await _devolver_para_fila(db, envio)
            await pausar_por_motivo(db, did, f"A Meta bloqueou o envio pelo número: {texto}{sufixo}")
            await liberar_vez(db, did, None)
            return "pausou_conta"
        if codigo == disparo_oficial.CODIGO_PAROU_MARKETING:
            envio.status, envio.erro_codigo, envio.erro = DESCADASTRADO, codigo, MOTIVO_131050
        else:
            envio.status, envio.erro_codigo, envio.erro = FALHOU, codigo, f"{texto}{sufixo}"[:500]
        envio.reservado_em = None
        await db.commit()
        await liberar_vez(db, did, proximo_horario(intervalo_ms, variacao_ms))
        if envio.status == FALHOU:
            await pausar_se_taxa(db, did)
        await finalizar_se_concluido(db, did)
        return envio.status

    envio.status = ENVIADO
    envio.wamid = str(res["message_id"])[:128] if res.get("message_id") else None
    envio.wa_id = str(res["wa_id"])[:32] if res.get("wa_id") else None
    envio.conversation_id = res.get("conversation_id")
    envio.enviado_em = _agora()
    envio.reservado_em = None
    envio.erro = None
    await db.commit()
    await liberar_vez(db, did, proximo_horario(intervalo_ms, variacao_ms))
    await pausar_se_taxa(db, did)
    await finalizar_se_concluido(db, did)
    return ENVIADO


async def processar_disparos_job() -> None:
    """Entrada do scheduler. Um contato por disparo por volta; o ritmo é a VEZ de cada um."""
    from core.db import db_context

    agora = _agora()
    try:
        async with db_context() as db:
            ids = (
                (
                    await db.execute(
                        select(D.id)
                        .where(
                            D.status == EM_ANDAMENTO,
                            or_(D.proximo_envio_em.is_(None), D.proximo_envio_em <= agora),
                        )
                        .order_by(D.id)
                        .limit(MAX_DISPAROS_POR_TICK)
                    )
                )
                .scalars()
                .all()
            )
    except Exception:  # noqa: BLE001
        logger.exception("disparo em lote: não consegui ler a fila")
        return
    for did in ids:
        try:
            async with db_context() as db:
                await processar_um(db, did)
        except Exception:  # noqa: BLE001 — um disparo com defeito não para os outros
            logger.exception("disparo em lote %s: falhou no passo", did)
            try:
                async with db_context() as db:
                    await pausar_por_motivo(
                        db, did, "Erro interno ao enviar — o disparo foi pausado. Retome; se repetir, chame o suporte."
                    )
            except Exception:  # noqa: BLE001
                logger.exception("disparo em lote %s: nem a pausa gravou", did)


def agendar(sched) -> None:
    """Pendura o worker no scheduler do Agent (chamado do startup, depois de `init_scheduler`).
    Sem lock Redis de propósito: a trava é a VEZ no banco, e dois processos olhando a fila só
    dividem disparos diferentes entre si."""
    from apscheduler.triggers.interval import IntervalTrigger

    sched.add_job(
        processar_disparos_job,
        trigger=IntervalTrigger(seconds=TICK_S),
        id="disparo_oficial_lote",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    logger.info("Scheduler: disparo em lote oficial (%ss)", TICK_S)
