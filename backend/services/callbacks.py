"""Callbacks — mensagens com hora marcada depois de uma fala do agente (11/11/2026, CCDA).

O robô antigo do CCDA (Dify + n8n) respondia em JSON com uma propriedade `callback` (`initial` ·
`proposal` · `objection` · `video` · `finished`) e o n8n, lendo essa marca, mandava sozinho uma
mensagem minutos depois se a família não respondesse. O Tier Agent não pede JSON ao modelo (a persona
do agente 26 tirou o `callback` de propósito). Aqui a marca é lida do que o agente DE FATO mandou: o
link do valor, o texto do Ensino Médio, o silêncio da família depois da nossa resposta. É
determinístico: não depende de o modelo lembrar de emitir nada.

Medido no robô antigo (Chatwoot do CCDA, 21/10–11/11/2026, 422 conversas, só leitura):
- «A proposta fez sentido?» saiu 30 min depois do link do valor (mediana 30,7 min).
- O vídeo do tour saiu 30 min depois da NOSSA última mensagem (mediana 30,0). No caminho que passa pela
  pergunta da proposta isso dá 1 h depois da última mensagem da família — o «após 1 h sem interação»
  que o cliente descreve. Fora desse caminho o robô mandava em 30 min. O atraso é dado da configuração.
- O fechamento saiu 30 min depois do link do tour (mediana 30,0; p90 30,0).
- Nenhum callback saiu depois de alguém da equipe escrever na conversa.

Por que não a cadência de follow-up nem playbook:
- A cadência (`scheduler.followup_inactivity_job`) é por TENANT, conta só desde a última mensagem da
  família, guarda UMA etapa na conversa (a mesma da cascata de 23h/D+3/D+7/D+10/D+13, que no CCDA
  substitui a cadência) e exige 20 h entre etapas. Passo de 30 min ancorado numa fala do agente não
  cabe ali sem quebrar a cascata.
- Playbook só dispara por mensagem que CHEGA (palavra-chave), botão ou cron, e quando casa SUBSTITUI a
  resposta da IA. O nó de espera não é cancelado quando o contato responde.

Configuração por AGENTE em `ta_runtime_param` (escopo='agent', key='callbacks'), JSON — o CCDA é só a
primeira. Lida a cada ciclo: editar vale no minuto seguinte, sem deploy. Formato em `carregar_config`.

Regras de envio (todas por conversa):
- Uma vez por passo (`ta_callback_envio`, único por conversa+passo, gravado ANTES de enviar).
- Não manda: conversa assumida (ou contato com conversa assumida nos últimos 7 dias), número em
  registro, IA desligada ou fora do horário da IA, contato descadastrado, visita já marcada no CRM
  (quando o agente tem agenda), conversa encerrada por uma frase de `parar_se_agente_disse`, nem se o
  contato (ou alguém da equipe) escreveu depois do gatilho.
- WhatsApp oficial: só dentro das 24 h desde a última mensagem do CONTATO. Fora, não manda e loga.
- Mensagem com link vira DUAS: o texto e depois o link, na ordem (o link sozinho abre a prévia).
- Passo vencido há mais que `tolerancia_min` (IA estava desligada, job parado) não sai: fora de hora
  a mensagem perde o contexto.

Quem recebe (12/11/2026, aprovado pelo dono: «ajustar quem recebe»). Na véspera o CCDA mandou o modelo
«visita_perdida_reagendar» a 87 famílias de visita perdida. Das 6 que responderam, 2 já tinham
matriculado, 1 escolheu outra escola e 2 eram resposta automática do WhatsApp comercial do pai — e o
tour («Antes de matricular o seu filho em qualquer outro Colégio…») iria para todas, porque o silêncio
do contato arma o passo em qualquer conversa. Quatro travas, todas na configuração, com padrão seguro:
- `so_conversa_iniciada_pelo_contato` (por passo; padrão LIGADO em `silencio_do_contato` e
  `depois_do_passo`, desligado em `fala_do_agente`): só sai se a 1ª mensagem da conversa é do contato
  e nenhum modelo nosso (`Disparo · …`/`Modelo · …`, ver `disparo_oficial`) entrou nela. Conversa que
  nós abrimos — ou reabrimos com modelo — é acompanhamento de família conhecida, não lead novo.
- `exige_passo` / `exige_fala_do_agente` (por passo, opcionais): só sai se aquele passo já foi
  enviado, ou se a IA já disse um daqueles textos na conversa. No CCDA o tour exige o link do valor
  (`ccda.com.br/valor-`): é o caminho da proposta, que era onde o robô antigo mandava o tour.
- `parar_se_agente_disse` ganha as frases de família matriculada e de outra escola (medidas no que o
  agente 26 respondeu de fato, sem as que aparecem em resposta comum de venda).
- `janela` (por configuração, opcional): `{"inicio": "08:00", "fim": "21:30", "tz": "America/Sao_Paulo"}`.
  Passo que vence fora dela não sai, como o atrasado: às 08:00 já perdeu o contexto. Necessária porque
  o horário da IA do número pode ser «sempre» (o do CCDA é).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

PARAM_KEY = "callbacks"
# Marca no `model_used` da mensagem (o passo vai depois: «Callback · proposta»). A cascata de
# reengajamento lê a última fala do agente para saber onde a família parou e pula esta marca.
MARCA_CALLBACK = "Callback"
# As marcas dos modelos que NÓS mandamos: `disparo_oficial.MARCA_DISPARO` e `MARCA_MODELO` (copiadas
# para as regras puras não importarem o banco; o teste confere que são as mesmas).
MARCAS_MODELO = ("Disparo", "Modelo")
FUSO_PADRAO = "America/Sao_Paulo"
_RE_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
LIMITE_HISTORICO = 300  # mensagens lidas por conversa no ciclo
CANAIS = ("whatsapp", "whatsapp_cloud")
JANELA_CLOUD = timedelta(hours=24)
# Conversas candidatas: mensagem do contato nas últimas 26 h (24 h da janela + folga da tolerância).
HORIZONTE = timedelta(hours=26)
TIPOS_GATILHO = ("fala_do_agente", "silencio_do_contato", "depois_do_passo")
TOLERANCIA_PADRAO_MIN = 30
INTERVALO_PADRAO_MIN = 10
ATRASO_MAX_MIN = 1440
MAX_CONVERSAS_POR_CICLO = 200
MAX_ENVIOS_POR_CICLO = 60
PAUSA_ENTRE_MENSAGENS_S = 1.2  # a mesma pausa entre balões da resposta da IA
_INTERRUPCAO = ("user", "agent")  # contato escreveu, ou alguém da equipe (painel, modelo, disparo)


# ───────────────────────── configuração ─────────────────────────


@dataclass(frozen=True)
class Gatilho:
    tipo: str
    contem: tuple[str, ...] = ()
    nao_contem: tuple[str, ...] = ()
    passo: str | None = None


@dataclass(frozen=True)
class Passo:
    id: str
    gatilho: Gatilho
    atraso_min: float
    mensagens: tuple[str, ...]
    pular_se_ja_enviado: str | None = None
    so_conversa_iniciada_pelo_contato: bool = False
    exige_passo: str | None = None
    exige_fala_do_agente: tuple[str, ...] = ()


@dataclass(frozen=True)
class Janela:
    """Horário em que callback pode sair (hora local do fuso): `inicio <= agora < fim`."""

    inicio: time
    fim: time
    tz: str = FUSO_PADRAO


@dataclass(frozen=True)
class Config:
    passos: tuple[Passo, ...]
    ativo: bool = True
    tolerancia_min: float = TOLERANCIA_PADRAO_MIN
    intervalo_minimo_min: float = INTERVALO_PADRAO_MIN
    parar_se_agente_disse: tuple[str, ...] = ()
    parar_se_visita_marcada: bool = True
    janela: Janela | None = None


def _lista_de_textos(v, campo: str, erros: list[str], *, obrigatoria: bool = False) -> tuple[str, ...]:
    if v is None:
        if obrigatoria:
            erros.append(f"{campo}: obrigatório")
        return ()
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        erros.append(f"{campo}: deve ser lista de textos")
        return ()
    limpos = tuple(x.strip() for x in v if x.strip())
    if obrigatoria and not limpos:
        erros.append(f"{campo}: lista vazia")
    return limpos


def _numero(v, campo: str, padrao: float, minimo: float, maximo: float, erros: list[str]) -> float:
    if v is None:
        return padrao
    if isinstance(v, bool) or not isinstance(v, int | float) or not (minimo <= v <= maximo):
        erros.append(f"{campo}: número entre {minimo:g} e {maximo:g}")
        return padrao
    return float(v)


def _ler_janela(v, erros: list[str]) -> tuple[Janela | None, bool]:
    """(janela, ok). Janela ilegível derruba a configuração inteira: ignorá-la mandaria a qualquer hora."""
    if v is None:
        return None, True
    if not isinstance(v, dict):
        erros.append('janela: objeto {"inicio": "08:00", "fim": "21:30", "tz": "America/Sao_Paulo"}')
        return None, False
    inicio, fim, tz = v.get("inicio"), v.get("fim"), v.get("tz", FUSO_PADRAO)
    if not all(isinstance(x, str) and _RE_HHMM.match(x) for x in (inicio, fim)):
        erros.append("janela: inicio e fim no formato HH:MM")
        return None, False
    if inicio >= fim:
        erros.append("janela: o início tem de ser antes do fim")
        return None, False
    try:
        ZoneInfo(tz)
    except Exception:  # noqa: BLE001 — ZoneInfoNotFoundError, ValueError, TypeError: qualquer fuso ruim
        erros.append(f"janela.tz: fuso desconhecido «{tz}»")
        return None, False
    return Janela(inicio=time.fromisoformat(inicio), fim=time.fromisoformat(fim), tz=tz), True


def carregar_config(bruto) -> tuple[Config | None, list[str]]:
    """Lê e valida a configuração. Devolve (config, erros); passo inválido sai com o erro dito.

    Formato:
        {"ativo": true, "tolerancia_min": 30, "intervalo_minimo_min": 10,
         "parar_se_visita_marcada": true, "parar_se_agente_disse": ["Trabalhe Conosco"],
         "passos": [
           {"id": "proposta", "atraso_min": 30,
            "gatilho": {"tipo": "fala_do_agente", "contem": ["ccda.com.br/valor-"], "nao_contem": [...]},
            "mensagens": ["A proposta fez sentido para você? ..."]},
           {"id": "tour", "atraso_min": 60, "gatilho": {"tipo": "silencio_do_contato"},
            "mensagens": ["Temos muitas outras novidades ...", "https://youtu.be/..."]},
           {"id": "fechamento", "atraso_min": 30, "gatilho": {"tipo": "depois_do_passo", "passo": "tour"},
            "mensagens": ["Antes de matricular ..."]}]}

    Gatilhos:
    - `fala_do_agente`: a ÚLTIMA resposta da IA que contém um dos textos de `contem` (e nenhum de
      `nao_contem`). O relógio conta dela; cancela se o contato ou a equipe escreveu depois.
    - `silencio_do_contato`: a IA respondeu e o contato não escreveu mais. Conta da última mensagem do
      contato.
    - `depois_do_passo`: conta do envio do passo citado; cancela se o contato ou a equipe escreveu depois.
    Comparação de texto sem acento e sem caixa. `pular_se_ja_enviado`: texto (ex.: o link do vídeo)
    que, já presente em mensagem nossa na conversa, faz o passo não sair — não repete o que já foi.

    Quem recebe (12/11/2026), por passo:
    - `so_conversa_iniciada_pelo_contato` (true/false): só sai em conversa que o CONTATO abriu e que
      nenhum modelo nosso reabriu. Padrão true em `silencio_do_contato` e `depois_do_passo` (o
      silêncio arma o passo em qualquer conversa); false em `fala_do_agente`.
    - `exige_passo`: id de outro passo que já tem de ter sido enviado.
    - `exige_fala_do_agente`: lista de textos; a IA já tem de ter dito um deles na conversa.
    E por configuração, `janela`: {"inicio": "08:00", "fim": "21:30", "tz": "America/Sao_Paulo"}.
    """
    erros: list[str] = []
    if bruto is None or (isinstance(bruto, str) and not bruto.strip()):
        return None, ["configuração vazia"]
    if isinstance(bruto, str):
        try:
            bruto = json.loads(bruto)
        except ValueError as e:
            return None, [f"JSON inválido: {e}"]
    if not isinstance(bruto, dict):
        return None, ["a configuração deve ser um objeto JSON"]

    ativo = bruto.get("ativo", True)
    if not isinstance(ativo, bool):
        erros.append("ativo: true ou false")
        ativo = False
    visita = bruto.get("parar_se_visita_marcada", True)
    if not isinstance(visita, bool):
        erros.append("parar_se_visita_marcada: true ou false")
        visita = True
    tolerancia = _numero(bruto.get("tolerancia_min"), "tolerancia_min", TOLERANCIA_PADRAO_MIN, 1, 720, erros)
    intervalo = _numero(bruto.get("intervalo_minimo_min"), "intervalo_minimo_min", INTERVALO_PADRAO_MIN, 0, 240, erros)
    parar = _lista_de_textos(bruto.get("parar_se_agente_disse"), "parar_se_agente_disse", erros)
    janela, janela_ok = _ler_janela(bruto.get("janela"), erros)
    if not janela_ok:
        return None, erros

    brutos = bruto.get("passos")
    if not isinstance(brutos, list) or not brutos:
        return None, [*erros, "passos: lista com ao menos um passo"]
    ids = [p.get("id") for p in brutos if isinstance(p, dict)]
    passos: list[Passo] = []
    vistos: set[str] = set()
    for i, p in enumerate(brutos):
        nome = f"passos[{i}]"
        if not isinstance(p, dict):
            erros.append(f"{nome}: deve ser objeto")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", pid):
            erros.append(f"{nome}.id: minúsculas, números e _ (até 64)")
            continue
        if pid in vistos:
            erros.append(f"{nome}.id: «{pid}» repetido")
            continue
        e0 = len(erros)
        g = p.get("gatilho") or {}
        tipo = g.get("tipo") if isinstance(g, dict) else None
        if tipo not in TIPOS_GATILHO:
            erros.append(f"{nome}.gatilho.tipo: um de {', '.join(TIPOS_GATILHO)}")
            continue
        contem = _lista_de_textos(
            g.get("contem"), f"{nome}.gatilho.contem", erros, obrigatoria=tipo == "fala_do_agente"
        )
        nao_contem = _lista_de_textos(g.get("nao_contem"), f"{nome}.gatilho.nao_contem", erros)
        ref = g.get("passo")
        if tipo == "depois_do_passo" and (not isinstance(ref, str) or ref == pid or ref not in ids):
            erros.append(f"{nome}.gatilho.passo: id de outro passo desta configuração")
        atraso = _numero(p.get("atraso_min"), f"{nome}.atraso_min", -1, 1, ATRASO_MAX_MIN, erros)
        if p.get("atraso_min") is None:
            erros.append(f"{nome}.atraso_min: obrigatório")
        mensagens = _lista_de_textos(p.get("mensagens"), f"{nome}.mensagens", erros, obrigatoria=True)
        pular = p.get("pular_se_ja_enviado")
        if pular is not None and (not isinstance(pular, str) or not pular.strip()):
            erros.append(f"{nome}.pular_se_ja_enviado: texto")
            pular = None
        # Quem recebe (12/11/2026). Erro aqui derruba o PASSO: na dúvida, não manda.
        so_contato = p.get("so_conversa_iniciada_pelo_contato", tipo != "fala_do_agente")
        if not isinstance(so_contato, bool):
            erros.append(f"{nome}.so_conversa_iniciada_pelo_contato: true ou false")
        exige_passo = p.get("exige_passo")
        if exige_passo is not None and (
            not isinstance(exige_passo, str) or exige_passo == pid or exige_passo not in ids
        ):
            erros.append(f"{nome}.exige_passo: id de outro passo desta configuração")
        bruta_fala = p.get("exige_fala_do_agente")
        exige_fala = _lista_de_textos(
            bruta_fala, f"{nome}.exige_fala_do_agente", erros, obrigatoria=bruta_fala is not None
        )
        if len(erros) > e0:
            continue
        vistos.add(pid)
        passos.append(
            Passo(
                id=pid,
                gatilho=Gatilho(
                    tipo=tipo, contem=contem, nao_contem=nao_contem, passo=ref if tipo == "depois_do_passo" else None
                ),
                atraso_min=atraso,
                mensagens=mensagens,
                pular_se_ja_enviado=(pular or "").strip() or None,
                so_conversa_iniciada_pelo_contato=so_contato,
                exige_passo=exige_passo,
                exige_fala_do_agente=exige_fala,
            )
        )
    # Passo que depende (gatilho ou exigência) de outro que caiu na validação nunca dispara: avisa.
    for p in passos:
        for dep in (p.gatilho.passo, p.exige_passo):
            if dep and dep not in vistos:
                erros.append(f"passo «{p.id}» depende de «{dep}», que está inválido")
    if not passos:
        return None, erros or ["nenhum passo válido"]
    cfg = Config(
        passos=tuple(passos),
        ativo=ativo,
        tolerancia_min=tolerancia,
        intervalo_minimo_min=intervalo,
        parar_se_agente_disse=parar,
        parar_se_visita_marcada=visita,
        janela=janela,
    )
    return cfg, erros


# ───────────────────────── regras puras ─────────────────────────


@dataclass(frozen=True)
class Msg:
    role: str
    content: str | None
    model_used: str | None
    em: datetime


@dataclass(frozen=True)
class Envio:
    status: str
    enviado_em: datetime | None


@dataclass(frozen=True)
class Vencido:
    passo: Passo
    ancora: datetime
    vence_em: datetime


@dataclass
class Avaliacao:
    vencido: Vencido | None = None
    motivos: dict[str, str] = field(default_factory=dict)


def normalizar(texto: str | None) -> str:
    """Sem acento, sem caixa, espaços colapsados. Pontuação fica: o link precisa dela."""
    s = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", s).strip().lower()


def _tem(texto_norm: str, marcas: tuple[str, ...]) -> bool:
    return any(normalizar(m) in texto_norm for m in marcas if normalizar(m))


def e_callback(m: Msg) -> bool:
    return m.role == "assistant" and (m.model_used or "").startswith(MARCA_CALLBACK)


def e_modelo_nosso(m: Msg) -> bool:
    """Modelo que NÓS mandamos (disparo do ERP ou «Nova conversa com modelo»)."""
    return m.role in ("agent", "assistant") and (m.model_used or "").startswith(MARCAS_MODELO)


def aberta_pelo_contato(msgs: list[Msg]) -> bool:
    """O contato abriu a conversa (a 1ª mensagem é dele) e nenhum modelo nosso a reabriu depois.

    Conversa que nós abrimos — modelo, mensagem da equipe, aviso — ou que reabrimos com modelo é
    acompanhamento de família conhecida (visita perdida, lembrete), não lead que sumiu depois do preço.
    `msgs` tem de começar na 1ª mensagem da conversa (o ciclo confere no banco quando o histórico
    lido foi cortado em `LIMITE_HISTORICO`)."""
    return bool(msgs) and msgs[0].role == "user" and not any(e_modelo_nosso(m) for m in msgs)


def dentro_da_janela(janela: Janela | None, agora: datetime) -> bool:
    """`agora` em UTC sem fuso (como o ciclo usa). Sem janela, qualquer hora."""
    if janela is None:
        return True
    local = agora.replace(tzinfo=UTC).astimezone(ZoneInfo(janela.tz)).time()
    return janela.inicio <= local < janela.fim


def _ultima(msgs: list[Msg], cond) -> int | None:
    return next((i for i in range(len(msgs) - 1, -1, -1) if cond(msgs[i])), None)


def _algum_depois(msgs: list[Msg], i: int, roles: tuple[str, ...]) -> bool:
    """Alguma mensagem com estes papéis DEPOIS da posição i. Pela ordem de gravação (id), não pelo
    relógio: a resposta da IA e a mensagem do contato podem cair no mesmo segundo."""
    return any(m.role in roles for m in msgs[i + 1 :])


def _ancora(passo: Passo, msgs: list[Msg], enviados: dict[str, Envio]) -> tuple[datetime | None, str]:
    g = passo.gatilho
    if g.tipo == "fala_do_agente":
        i = _ultima(
            msgs,
            lambda m: (
                m.role == "assistant"
                and not e_callback(m)
                and _tem(normalizar(m.content), g.contem)
                and not _tem(normalizar(m.content), g.nao_contem)
            ),
        )
        if i is None:
            return None, "sem_gatilho"
        if _algum_depois(msgs, i, _INTERRUPCAO):
            return None, "respondeu_depois"
        return msgs[i].em, ""
    if g.tipo == "silencio_do_contato":
        i = _ultima(msgs, lambda m: m.role == "user")
        if i is None:
            return None, "sem_mensagem_do_contato"
        if _algum_depois(msgs, i, ("agent",)):
            return None, "equipe_respondeu"
        if not _algum_depois(msgs, i, ("assistant",)):
            return None, "ia_nao_respondeu"
        return msgs[i].em, ""
    # depois_do_passo: conta da ÚLTIMA mensagem do passo anterior (no robô antigo, o fechamento saía
    # 30 min depois do LINK do tour, que é a segunda mensagem dele).
    anterior = enviados.get(g.passo or "")
    if anterior is None or anterior.status != "enviado":
        return None, "passo_anterior_nao_saiu"
    marca = f"{MARCA_CALLBACK} · {g.passo}"
    i = _ultima(msgs, lambda m: e_callback(m) and m.model_used == marca)
    if i is None:
        return None, "passo_anterior_nao_saiu"
    if _algum_depois(msgs, i, _INTERRUPCAO):
        return None, "respondeu_depois"
    return msgs[i].em, ""


def avaliar(
    cfg: Config, msgs: list[Msg], enviados: dict[str, Envio], agora: datetime, *, aberta: bool | None = None
) -> Avaliacao:
    """O passo a mandar AGORA nesta conversa (no máximo um), ou nenhum — com o motivo de cada passo.

    Puro: lê as mensagens (em ordem) e os passos já gravados. Cruzamento: dois passos vencidos ao mesmo
    tempo saem um por ciclo, na ordem da configuração, com `intervalo_minimo_min` entre eles.
    `aberta`: se o contato abriu a conversa; None = deduz de `msgs` (que então começa na 1ª mensagem).
    """
    r = Avaliacao()
    if not cfg.ativo:
        r.motivos["*"] = "desligado"
        return r
    nossas = [normalizar(m.content) for m in msgs if m.role in ("assistant", "agent") and not e_callback(m)]
    if cfg.parar_se_agente_disse and any(_tem(t, cfg.parar_se_agente_disse) for t in nossas):
        r.motivos["*"] = "encerrada"
        return r
    ja_ditas = [normalizar(m.content) for m in msgs if m.role in ("assistant", "agent")]
    falas_ia = [normalizar(m.content) for m in msgs if m.role == "assistant" and not e_callback(m)]
    if aberta is None:
        aberta = aberta_pelo_contato(msgs)
    ultimo_envio = max(
        (e.enviado_em for e in enviados.values() if e.status == "enviado" and e.enviado_em), default=None
    )
    for passo in cfg.passos:
        if passo.id in enviados:
            r.motivos[passo.id] = "ja_feito"
            continue
        if passo.so_conversa_iniciada_pelo_contato and not aberta:
            r.motivos[passo.id] = "aberta_por_nos"
            continue
        exigido = enviados.get(passo.exige_passo or "")
        if passo.exige_passo and (exigido is None or exigido.status != "enviado"):
            r.motivos[passo.id] = "sem_passo_exigido"
            continue
        if passo.exige_fala_do_agente and not any(_tem(t, passo.exige_fala_do_agente) for t in falas_ia):
            r.motivos[passo.id] = "sem_fala_exigida"
            continue
        ancora, motivo = _ancora(passo, msgs, enviados)
        if ancora is None:
            r.motivos[passo.id] = motivo
            continue
        vence = ancora + timedelta(minutes=passo.atraso_min)
        if agora < vence:
            r.motivos[passo.id] = "aguardando"
            continue
        if agora > vence + timedelta(minutes=cfg.tolerancia_min):
            r.motivos[passo.id] = "atrasado"
            continue
        if passo.pular_se_ja_enviado and any(normalizar(passo.pular_se_ja_enviado) in t for t in ja_ditas):
            r.motivos[passo.id] = "ja_enviado"
            continue
        if not dentro_da_janela(cfg.janela, agora):
            # Como a tolerância: não fica guardado. Quando a janela abre, sai só se ainda estiver no prazo.
            r.motivos[passo.id] = "fora_da_janela"
            continue
        if ultimo_envio and agora < ultimo_envio + timedelta(minutes=cfg.intervalo_minimo_min):
            r.motivos[passo.id] = "intervalo"
            return r  # espera o intervalo; o próximo da fila não fura a vez
        r.motivos[passo.id] = "vencido"
        r.vencido = Vencido(passo=passo, ancora=ancora, vence_em=vence)
        return r
    return r


def janela_aberta(msgs: list[Msg], agora: datetime) -> bool:
    """WhatsApp oficial: texto livre só sai dentro das 24 h desde a última mensagem do CONTATO."""
    ultima = next((m.em for m in reversed(msgs) if m.role == "user"), None)
    return ultima is not None and agora - ultima < JANELA_CLOUD


_URL_PONTA = ".,;)]}'\"»"


def separar_links(mensagens) -> list[str]:
    """Mensagem com texto E link vira duas: o texto, depois o link (a prévia só abre com o link sozinho).

    `["Vou te mandar um vídeo: https://youtu.be/x"]` → `["Vou te mandar um vídeo:", "https://youtu.be/x"]`.
    Link já sozinho, ou texto sem link, fica como está. A ordem da configuração é mantida.
    """
    from services.previa_link import URL_RE

    saida: list[str] = []
    for bruta in mensagens:
        texto = (bruta or "").strip()
        if not texto:
            continue
        links = [m.group(0).rstrip(_URL_PONTA) for m in URL_RE.finditer(texto)]
        resto = texto
        for link in links:
            resto = resto.replace(link, " ")
        resto = re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", resto))
        resto = re.sub(r"[ \t]+([.,;:!?])", r"\1", resto).strip()
        if not links or not resto:
            saida.append(texto)
            continue
        saida.append(resto)
        saida.extend(links)
    return saida


def com_nome(texto: str, contact_name: str | None) -> str:
    """`{nome}` vira o primeiro nome do contato; sem nome, some (com a vírgula antes)."""
    nome = (contact_name or "").strip().split(" ")[0]
    if nome:
        return texto.replace("{nome}", nome)
    return texto.replace(", {nome}", "").replace("{nome}", "").replace("  ", " ")


# ───────────────────────── banco + envio ─────────────────────────

# Aviso de bloqueio uma vez por (conversa, passo, âncora, motivo): o passo fica vencido por até
# `tolerancia_min` e o ciclo roda a cada minuto. Memória do processo; recomeça no deploy.
_avisados: set[tuple] = set()
_config_avisada: dict[int, str] = {}


def _avisar(conv_id: int, passo: str, ancora: datetime, motivo: str, msg: str, *args) -> None:
    chave = (conv_id, passo, ancora.isoformat(), motivo)
    if chave in _avisados:
        return
    if len(_avisados) > 5000:
        _avisados.clear()
    _avisados.add(chave)
    logger.info(msg, *args)


async def configs_ativas(db) -> dict[int, tuple[Config, int]]:
    """{agent_id: (config, tenant_id)} dos agentes ativos com callbacks ligados (registro fica fora)."""
    from sqlalchemy import or_, select

    from models import TaAgent, TaRuntimeParam

    linhas = (
        await db.execute(
            select(TaRuntimeParam.escopo_id, TaRuntimeParam.value).where(
                TaRuntimeParam.escopo == "agent", TaRuntimeParam.key == PARAM_KEY
            )
        )
    ).all()
    lidas: dict[int, Config] = {}
    for agent_id, valor in linhas:
        cfg, erros = carregar_config(valor)
        if erros and _config_avisada.get(agent_id) != valor:  # uma vez por versão da configuração
            _config_avisada[agent_id] = valor
            logger.warning("callbacks: configuração do agente %s com problema: %s", agent_id, "; ".join(erros)[:500])
        if cfg and cfg.ativo and agent_id:
            lidas[int(agent_id)] = cfg
    if not lidas:
        return {}
    agentes = (
        await db.execute(
            select(TaAgent.id, TaAgent.tenant_id).where(
                TaAgent.id.in_(list(lidas)),
                TaAgent.active.is_(True),
                or_(TaAgent.template_kind.is_(None), TaAgent.template_kind != "registro"),
            )
        )
    ).all()
    return {aid: (lidas[aid], tid) for aid, tid in agentes}


async def _mensagens(db, conversation_id: int) -> list[Msg]:
    from sqlalchemy import select

    from models import TaMessageLog

    linhas = (
        await db.execute(
            select(TaMessageLog.role, TaMessageLog.content, TaMessageLog.model_used, TaMessageLog.created_at)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.role.in_(("user", "assistant", "agent")),
            )
            .order_by(TaMessageLog.id.desc())
            .limit(LIMITE_HISTORICO)
        )
    ).all()
    return [Msg(role=r, content=c, model_used=mu, em=em) for r, c, mu, em in reversed(linhas) if em is not None]


async def _aberta_no_banco(db, conversation_id: int) -> bool:
    """`aberta_pelo_contato` para conversa maior que `LIMITE_HISTORICO`: a 1ª mensagem e os modelos
    podem ter ficado fora do que o ciclo leu."""
    from sqlalchemy import or_, select

    from models import TaMessageLog

    primeira = (
        await db.execute(
            select(TaMessageLog.role)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.role.in_(("user", "assistant", "agent")),
            )
            .order_by(TaMessageLog.id)
            .limit(1)
        )
    ).scalar()
    if primeira != "user":
        return False
    modelo = (
        await db.execute(
            select(TaMessageLog.id)
            .where(
                TaMessageLog.conversation_id == conversation_id,
                TaMessageLog.role.in_(("agent", "assistant")),
                or_(*(TaMessageLog.model_used.like(f"{m}%") for m in MARCAS_MODELO)),
            )
            .limit(1)
        )
    ).scalar()
    return modelo is None


async def _enviados(db, conversation_id: int) -> dict[str, Envio]:
    from sqlalchemy import select

    from models import TaCallbackEnvio

    linhas = (
        await db.execute(
            select(TaCallbackEnvio.passo, TaCallbackEnvio.status, TaCallbackEnvio.enviado_em).where(
                TaCallbackEnvio.conversation_id == conversation_id
            )
        )
    ).all()
    return {p: Envio(status=s, enviado_em=em) for p, s, em in linhas}


async def _bloqueio(db, conv, cfg: Config, tenant_id: int, msgs: list[Msg], agora: datetime):
    """(motivo, None) se não pode mandar agora; (None, conector) se pode. A ordem importa pouco:
    qualquer trava segura o envio."""
    import scheduler as _sched
    from services import disparo_oficial, proactive
    from services.agent_runtime import ia_responde_agora

    if await proactive.conversa_e_registro(db, conv):
        return "numero_em_registro", None
    conn = await proactive.conector_da_conversa(db, conv)
    if conn is None:
        return "sem_numero", None
    if not ia_responde_agora(conn):
        return "ia_desligada_ou_fora_do_horario", None
    if conv.connector_kind == "whatsapp_cloud" and not janela_aberta(msgs, agora):
        return "janela_24h_fechada", None
    if await disparo_oficial.esta_descadastrado(db, tenant_id, conv.external_id):
        return "descadastrado", None
    if cfg.parar_se_visita_marcada:
        ctx = await _sched._cascata_contexto(db, conv)  # best-effort: CRM fora = segue, como a cascata
        if ctx.get("visita_marcada"):
            return "visita_marcada", None
    return None, conn


async def _reservar(db, conv, passo: Passo, ancora: datetime) -> object | None:
    """Grava o passo ANTES de enviar (uma vez por conversa+passo). Outro processo já gravou = None.

    Mesma lição do follow-up: no deploy rodam dois containers por alguns segundos, e a marca gravada
    depois do envio deixou sair a mesma mensagem duas vezes (4,6 ms de diferença)."""
    from sqlalchemy.exc import IntegrityError

    from models import TaCallbackEnvio

    linha = TaCallbackEnvio(
        conversation_id=conv.id,
        agent_id=conv.agent_id,
        passo=passo.id,
        ancora_em=ancora,
        status="enviando",
        criado_em=datetime.utcnow(),
    )
    db.add(linha)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None
    return linha


@dataclass(frozen=True)
class _Conversa:
    """O que o ciclo usa da conversa — os nomes de `TaConversation`, que `proactive` lê."""

    id: int
    agent_id: int
    connector_kind: str
    external_id: str
    connector_id: int | None
    contact_name: str | None


async def _enviar_passo(db, conv, conn, passo: Passo, linha) -> bool:
    """Manda as mensagens do passo, em ordem, e grava cada uma na conversa. Para na primeira falha
    (o link nunca sai sem o texto que o apresenta)."""
    from models import TaMessageLog
    from services import proactive

    textos = separar_links([com_nome(t, conv.contact_name) for t in passo.mensagens])
    saiu = 0
    for i, texto in enumerate(textos):
        if i and PAUSA_ENTRE_MENSAGENS_S:
            await asyncio.sleep(PAUSA_ENTRE_MENSAGENS_S)
        if not await proactive.send_text_via_connector(conn, conv.external_id, texto):
            break
        db.add(
            TaMessageLog(
                conversation_id=conv.id,
                role="assistant",
                content=texto[:8000],
                model_used=f"{MARCA_CALLBACK} · {passo.id}"[:128],
            )
        )
        await db.commit()
        saiu += 1
    ok = saiu == len(textos)
    linha.status = "enviado" if ok else "falhou"
    linha.motivo = None if ok else ("envio_parcial" if saiu else "envio_falhou")
    linha.enviado_em = datetime.utcnow() if saiu else None
    await db.commit()
    return ok


async def rodar_ciclo(db, agora: datetime | None = None) -> dict:
    """Um ciclo do job: acha os passos vencidos e manda (no máximo um passo por conversa)."""
    from collections import Counter

    from sqlalchemy import select

    import scheduler as _sched
    from models import TaConversation

    agora = agora or datetime.utcnow()
    cfgs = await configs_ativas(db)
    if not cfgs:
        return {"conversas": 0, "enviados": 0, "bloqueados": {}}
    # Só as colunas, não o objeto: o `rollback` da reserva perdida expira tudo o que a sessão
    # carregou, e objeto expirado numa AsyncSession é MissingGreenlet no próximo atributo.
    linhas = (
        await db.execute(
            select(
                TaConversation.id,
                TaConversation.agent_id,
                TaConversation.connector_kind,
                TaConversation.external_id,
                TaConversation.connector_id,
                TaConversation.contact_name,
            )
            .where(
                TaConversation.agent_id.in_(list(cfgs)),
                TaConversation.status == "active",
                TaConversation.connector_kind.in_(CANAIS),
                TaConversation.last_message_at >= agora - HORIZONTE,
                _sched._sem_atendimento_humano(agora),  # contato com conversa assumida: o bot cala
            )
            .order_by(TaConversation.last_message_at.desc())
            .limit(MAX_CONVERSAS_POR_CICLO)
        )
    ).all()
    convs = [_Conversa(*linha) for linha in linhas]
    enviados = 0
    bloqueados: Counter = Counter()
    for conv in convs:
        if enviados >= MAX_ENVIOS_POR_CICLO:
            break
        cfg, tenant_id = cfgs[conv.agent_id]
        msgs = await _mensagens(db, conv.id)
        aberta = await _aberta_no_banco(db, conv.id) if len(msgs) >= LIMITE_HISTORICO else None
        av = avaliar(cfg, msgs, await _enviados(db, conv.id), agora, aberta=aberta)
        if av.vencido is None:
            continue
        passo, ancora = av.vencido.passo, av.vencido.ancora
        motivo, conn = await _bloqueio(db, conv, cfg, tenant_id, msgs, agora)
        if motivo:
            bloqueados[motivo] += 1
            _avisar(
                conv.id,
                passo.id,
                ancora,
                motivo,
                "callbacks: conversa %s passo %s não saiu — %s",
                conv.id,
                passo.id,
                motivo,
            )
            continue
        linha = await _reservar(db, conv, passo, ancora)
        if linha is None:
            continue
        if await _enviar_passo(db, conv, conn, passo, linha):
            enviados += 1
            logger.info("callbacks: conversa %s passo %s enviado (agente %s)", conv.id, passo.id, conv.agent_id)
        else:
            logger.warning("callbacks: conversa %s passo %s falhou no envio (%s)", conv.id, passo.id, linha.motivo)
    return {"conversas": len(convs), "enviados": enviados, "bloqueados": dict(bloqueados)}
