"""A «capinha» do link (título, descrição e miniatura) — igual à do WhatsApp.

Duas origens, porque no WhatsApp quem monta a capinha é quem ENVIA:

1. Mensagem que CHEGOU (do cliente, ou da consultora pelo celular): a capinha
   já vem pronta dentro da mensagem (`extendedTextMessage.title/description/
   jpegThumbnail`, a miniatura em base64). Só copiar — `previa_do_whatsapp`.
2. Mensagem que o painel ENVIOU: quem monta é o Engine na hora do envio, e o eco
   dela é descartado de propósito (senão a resposta entraria duas vezes). Então
   o Agent monta a sua, lendo as tags `og:` da página, como o WhatsApp Web faz
   no navegador — `montar_previa`.

🚨 `montar_previa` faz requisição para fora a partir do servidor. Só roda para
texto escrito pela equipe (resposta do painel), nunca para o que o cliente
manda, e recusa qualquer endereço que não seja público (rede interna do Docker,
banco, Redis, Coolify): cada salto de redirecionamento é conferido de novo.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import ipaddress
import json
import logging
import re
import socket
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit

import httpx

logger = logging.getLogger(__name__)

URL_RE = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"']+")
_PONTA = ".,;:!?)]}'\"»"
# 2 MB: no YouTube o <title> está depois de 700 KB de script (medido 07/10/2026)
_MAX_HTML = 2 * 1024 * 1024
_MAX_IMAGEM = 3 * 1024 * 1024
_MAX_MINIATURA_B64 = 90_000  # ~65 KB de jpeg; a do WhatsApp tem 3–6 KB
_LARGURA_MINIATURA = 192  # a mesma do Baileys
_UA = "Mozilla/5.0 (compatible; TierAgent-LinkPreview/1.0; +https://agent.tier.finance)"


def primeira_url(texto: str | None) -> str | None:
    """Primeiro link do texto, sem a pontuação colada no fim («veja: site.com.»)."""
    m = URL_RE.search(texto or "")
    if not m:
        return None
    url = m.group(0).rstrip(_PONTA)
    if url.lower().startswith("www."):
        url = "https://" + url
    return url


def _limpar(v, limite: int) -> str | None:
    if not isinstance(v, str):
        return None
    v = " ".join(v.split())
    return v[:limite] or None


def previa_do_whatsapp(msg: dict | None) -> dict | None:
    """Capinha que veio PRONTA na mensagem do WhatsApp (quem enviou já montou)."""
    ext = (msg or {}).get("extendedTextMessage") if isinstance(msg, dict) else None
    if not isinstance(ext, dict):
        return None
    titulo = _limpar(ext.get("title"), 300)
    if not titulo:
        return None  # sem título o WhatsApp também não desenha capinha
    url = ext.get("canonicalUrl") or ext.get("matchedText") or primeira_url(ext.get("text"))
    if not isinstance(url, str) or not url:
        return None
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    previa = {"kind": "link", "url": url, "title": titulo}
    descricao = _limpar(ext.get("description"), 500)
    if descricao:
        previa["description"] = descricao
    thumb = ext.get("jpegThumbnail")
    if isinstance(thumb, str) and 0 < len(thumb) <= _MAX_MINIATURA_B64:
        previa["thumb"] = "data:image/jpeg;base64," + thumb
    return previa


# ─── montar a capinha de um link enviado pelo painel ────────────────────────


async def _host_publico(host: str | None) -> bool:
    """Só deixa sair para endereço público da internet (nada de rede interna)."""
    if not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        pass
    infos = None
    for tentativa in range(2):  # o DNS do container falha de vez em quando (medido 07/10/2026)
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
            break
        except OSError:
            if tentativa:
                return False
            await asyncio.sleep(0.4)
    if not infos:
        return False
    return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


async def _url_permitida(url: str) -> bool:
    try:
        partes = urlsplit(url)
    except ValueError:
        return False
    if partes.scheme not in ("http", "https"):
        return False
    if partes.port not in (None, 80, 443):
        return False
    return await _host_publico(partes.hostname)


# 🚨 O servidor fica na Alemanha: sem consentimento aceito, YouTube e Google
# redirecionam para consent.* e a capinha sai «Bevor Sie zu YouTube weitergehen»
# (medido 07/10/2026). `SOCS=CAI` é o cookie de consentimento que o navegador já
# tem; `CONSENT=YES+cb` (o antigo) não basta mais. Só para os domínios do Google.
_DOMINIOS_CONSENTIMENTO = ("youtube.com", "youtu.be", "google.com", "google.com.br")


def _cabecalhos_do_host(url: str) -> dict[str, str]:
    host = (urlsplit(url).hostname or "").lower()
    if any(host == d or host.endswith("." + d) for d in _DOMINIOS_CONSENTIMENTO):
        return {"Cookie": "SOCS=CAI"}
    return {}


async def _baixar(cli: httpx.AsyncClient, url: str, limite: int) -> tuple[str, str, bytes] | None:
    """GET seguindo até 4 redirecionamentos, conferindo cada destino. Devolve (url final, content-type, corpo)."""
    for _ in range(5):
        if not await _url_permitida(url):
            return None
        async with cli.stream("GET", url, headers=_cabecalhos_do_host(url)) as r:
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                url = urljoin(url, r.headers["location"])
                continue
            if r.status_code != 200:
                return None
            corpo = bytearray()
            async for pedaco in r.aiter_bytes():
                corpo.extend(pedaco)
                if len(corpo) >= limite:
                    break
            return str(r.url), r.headers.get("content-type", ""), bytes(corpo[:limite])
    return None


def _lado(sizes: str) -> int:
    m = re.search(r"(\d+)\s*x\s*\d+", sizes or "")
    return int(m.group(1)) if m else 0


class _LeitorMeta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.titulo: str = ""
        self._no_title = False
        self.icones: list[tuple[int, str]] = []  # (prioridade, href) — reserva para a miniatura

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            a = {k.lower(): (v or "") for k, v in attrs}
            chave = (a.get("property") or a.get("name") or "").lower()
            if chave and a.get("content") and chave not in self.meta:
                self.meta[chave] = a["content"]
        elif tag == "link":
            a = {k.lower(): (v or "") for k, v in attrs}
            rel, href = a.get("rel", "").lower(), a.get("href", "").strip()
            if not href:
                return
            if "image_src" in rel:
                self.icones.append((10_000, href))
            elif "apple-touch-icon" in rel:
                self.icones.append((5_000 + _lado(a.get("sizes", "")), href))
            elif "icon" in rel.split() and _lado(a.get("sizes", "")) >= 64:
                self.icones.append((_lado(a.get("sizes", "")), href))
        elif tag == "title":
            self._no_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._no_title = False

    def handle_data(self, data):
        if self._no_title and len(self.titulo) < 500:
            self.titulo += data


def _ler_html(corpo: bytes, content_type: str) -> _LeitorMeta:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    cod = m.group(1) if m else "utf-8"
    try:
        texto = corpo.decode(cod, errors="replace")
    except LookupError:
        texto = corpo.decode("utf-8", errors="replace")
    leitor = _LeitorMeta()
    with contextlib.suppress(Exception):  # HTML quebrado: fica com o que deu para ler
        leitor.feed(texto)
    return leitor


def _miniatura(dados: bytes) -> str | None:
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(dados))
        img.thumbnail((_LARGURA_MINIATURA, _LARGURA_MINIATURA * 2))
        if img.mode not in ("RGB", "L"):
            fundo = Image.new("RGB", img.size, (255, 255, 255))
            img = img.convert("RGBA")
            fundo.paste(img, mask=img.split()[-1])
            img = fundo
        saida = io.BytesIO()
        img.convert("RGB").save(saida, format="JPEG", quality=70, optimize=True)
        b64 = base64.b64encode(saida.getvalue()).decode()
        return "data:image/jpeg;base64," + b64 if len(b64) <= _MAX_MINIATURA_B64 else None
    except Exception:  # noqa: BLE001 — imagem que não abre: capinha sem miniatura
        return None


async def _miniatura_de(cli: httpx.AsyncClient, url_imagem: str | None) -> str | None:
    if not url_imagem:
        return None
    img = await _baixar(cli, url_imagem, _MAX_IMAGEM)
    if img and img[1].lower().startswith("image/"):
        return await asyncio.to_thread(_miniatura, img[2])
    return None


def _e_youtube(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host in ("youtu.be", "youtube.com") or host.endswith(".youtube.com")


async def _montar_youtube(cli: httpx.AsyncClient, url: str) -> dict | None:
    """YouTube pelo oEmbed — o JSON que o próprio YouTube publica para isso. A página
    do vídeo tem 1,4 MB e o título só aparece depois de 700 KB de script."""
    r = await _baixar(cli, f"https://www.youtube.com/oembed?format=json&url={quote(url, safe='')}", 64 * 1024)
    if not r:
        return None
    try:
        dados = json.loads(r[2])
    except ValueError:
        return None
    titulo = _limpar(dados.get("title"), 300)
    if not titulo:
        return None
    previa = {"kind": "link", "url": url, "title": titulo}
    autor = _limpar(dados.get("author_name"), 200)
    if autor:
        previa["description"] = autor
    thumb = await _miniatura_de(cli, dados.get("thumbnail_url"))
    if thumb:
        previa["thumb"] = thumb
    return previa


async def _montar(url: str) -> dict | None:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(5.0, connect=3.0),
        follow_redirects=False,
        transport=httpx.AsyncHTTPTransport(retries=1),
        headers={"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9"},
    ) as cli:
        if _e_youtube(url):
            previa = await _montar_youtube(cli, url)
            if previa:
                return previa
            # oEmbed só cobre vídeo; canal e playlist seguem pela página
        pagina = await _baixar(cli, url, _MAX_HTML)
        if not pagina:
            return None
        final, tipo, corpo = pagina
        if "html" not in tipo.lower():
            return None
        meta = _ler_html(corpo, tipo)
        m = meta.meta
        titulo = _limpar(m.get("og:title") or m.get("twitter:title") or meta.titulo, 300)
        if not titulo:
            return None
        previa = {"kind": "link", "url": url, "title": titulo}
        descricao = _limpar(m.get("og:description") or m.get("twitter:description") or m.get("description"), 500)
        if descricao:
            previa["description"] = descricao
        # Imagem da página; sem ela, o ícone do site — o WhatsApp também cai no ícone.
        imagem = m.get("og:image") or m.get("og:image:url") or m.get("twitter:image")
        if not imagem and meta.icones:
            imagem = max(meta.icones)[1]
        thumb = await _miniatura_de(cli, urljoin(final, imagem.strip()) if imagem else None)
        if thumb:
            previa["thumb"] = thumb
        return previa


async def montar_previa(texto: str | None, *, prazo: float = 15.0) -> dict | None:
    """Capinha do primeiro link do texto. Nunca levanta: sem capinha é o normal."""
    url = primeira_url(texto)
    if not url:
        return None
    try:
        return await asyncio.wait_for(_montar(url), timeout=prazo)
    except Exception as e:  # noqa: BLE001
        logger.info("capinha do link nao montada url=%s motivo=%s", url[:120], e.__class__.__name__)
        return None


# ─── anexos → o que vai para `ta_message_log.attachments_json` ──────────────

_CAMPOS_EXTRAS = ("name", "title", "description", "thumb", "erro")


def anexos_para_log(anexos) -> list[dict]:
    """O que fica gravado de cada anexo. Mídia que NÃO baixou também entra (com
    `erro`): sumir sem rastro foi o defeito de 07/10/2026 — a família mandava a
    foto, o inbox não mostrava nada e ninguém sabia que tinha chegado algo."""
    saida: list[dict] = []
    for a in anexos or []:
        url = getattr(a, "url", None)
        erro = getattr(a, "erro", None)
        if not url and not erro:
            continue
        item = {"kind": getattr(a, "kind", None) or "file", "url": url, "mime": getattr(a, "mime", None)}
        for campo in _CAMPOS_EXTRAS:
            valor = getattr(a, campo, None)
            if valor:
                item[campo] = valor
        saida.append(item)
    return saida
