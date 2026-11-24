"""Como a conversa do WhatsApp foi aberta, lido da própria mensagem.

No número NÃO oficial (motor) o WhatsApp conta de onde a pessoa veio dentro de
`contextInfo`, e o motor entrega a mensagem inteira. No número OFICIAL (Cloud API) a
mesma informação vem em `referral`, outro formato (`sinal_do_referral`). Isso diz mais do que o texto: o anúncio da Meta abre com uma frase
padrão que não cita a campanha, e o cliente pode apagar qualquer texto pronto.

Valores medidos no motor em 06/11/2026 (todas as contas):

- `externalAdReply`: `sourceId` é o id do anúncio, `sourceApp` é instagram/facebook,
  `sourceUrl` é o post, `ctwaClid` marca o clique no anúncio.
- `entryPointConversionSource`: `click_to_chat_link`, `global_search_new_chat`,
  `group_participant_list`, `status`.
- `conversionSource`: `FB_Ads`.

Quem decide o que isso significa no CRM é o ERP (`services/crm_lead_agente.py`), por
conta: aqui só se traduz, sem regra de negócio.
"""

from __future__ import annotations

import unicodedata

_TAMANHO_DO_TEXTO = 300


def sem_invisiveis(texto: str | None) -> str:
    """Tira os caracteres invisíveis (categoria Cf).

    🚨 O botão do site da M7 esconde 265 deles no meio de uma palavra. Cortar a
    mensagem em 300 caracteres sem isto deixaria só a primeira metade da frase.
    """
    return "".join(c for c in (texto or "") if unicodedata.category(c) != "Cf")


def _contexto(msg: dict) -> dict | None:
    """`contextInfo` mora dentro do tipo da mensagem: texto, imagem, vídeo, áudio."""
    for bloco in msg.values():
        if isinstance(bloco, dict) and isinstance(bloco.get("contextInfo"), dict):
            return bloco["contextInfo"]
    return None


def sinal_de_origem(msg: dict | None) -> dict | None:
    """O que a mensagem diz sobre o caminho da pessoa, ou `None` quando não diz nada.

    🚨 Mensagem ENCAMINHADA não conta: quem repassa um anúncio não veio dele, e o
    `contextInfo` do original viaja junto (medido nas mensagens internas da M7).
    """
    ctx = _contexto(msg) if isinstance(msg, dict) else None
    if not ctx or ctx.get("isForwarded"):
        return None
    anuncio = ctx.get("externalAdReply") if isinstance(ctx.get("externalAdReply"), dict) else {}
    sinal = {
        "entrada": ctx.get("entryPointConversionSource"),
        "entrada_app": ctx.get("entryPointConversionApp"),
        "conversao": ctx.get("conversionSource"),
        "anuncio_id": anuncio.get("sourceId"),
        "anuncio_app": anuncio.get("sourceApp"),
        "anuncio_url": anuncio.get("sourceUrl"),
        "anuncio_texto": (anuncio.get("body") or "")[:_TAMANHO_DO_TEXTO],
        "ctwa": bool(anuncio.get("ctwaClid") or ctx.get("ctwaClid")),
    }
    limpo = {k: v for k, v in sinal.items() if v}
    return limpo or None


def sinal_do_referral(mensagem: dict | None) -> dict | None:
    """O mesmo sinal, na mensagem do número OFICIAL (Cloud API). `None` quando não veio de anúncio.

    🚨 24/11/2026 (M7, card 31447): o caminho oficial não lia `referral`. Medido desde que os
    anúncios passaram a apontar para ele: 67 cliques na M7 e 11 no CCDA entraram no CRM como
    «Chegou direto pelo WhatsApp», com a campanha no corpo da mensagem.

    A Meta não diz o aplicativo do clique: ele sai do link, e `fb.me` não diz nenhum dos dois.
    `source_type` = `post` traz o id da PUBLICAÇÃO, que não abre campanha: sem id, e o link fica.
    """
    ref = mensagem.get("referral") if isinstance(mensagem, dict) else None
    if not isinstance(ref, dict) or not ref:
        return None
    url = str(ref.get("source_url") or "")
    dominio = url.lower()
    sinal = {
        "anuncio_id": str(ref.get("source_id") or "") if ref.get("source_type") in (None, "ad") else "",
        "anuncio_app": "instagram" if "instagram" in dominio else "facebook" if "facebook" in dominio else "",
        "anuncio_url": url,
        "anuncio_texto": str(ref.get("body") or ref.get("headline") or "").strip()[:_TAMANHO_DO_TEXTO],
        "ctwa": bool(ref.get("ctwa_clid")),
    }
    limpo = {k: v for k, v in sinal.items() if v}
    return limpo or None
