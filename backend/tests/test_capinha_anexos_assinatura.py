"""Inbox igual ao WhatsApp (07/10/2026): capinha do link, mídia que não baixou,
assinatura com o nome de quem respondeu."""

import base64

from services.assinatura import com_assinatura, primeiro_nome, tirar_assinatura
from services.connectors.base import ConnectorAttachment
from services.previa_link import _url_permitida, anexos_para_log, previa_do_whatsapp, primeira_url

MINIATURA = base64.b64encode(b"\xff\xd8\xff\xe0" + b"x" * 200).decode()


# ─── capinha que vem PRONTA do WhatsApp ─────────────────────────────────────


def test_capinha_do_whatsapp_vira_anexo_link():
    msg = {
        "extendedTextMessage": {
            "text": "olha o site https://www.ccda.com.br",
            "matchedText": "https://www.ccda.com.br",
            "title": "CCDA – Colégio Carlos Drummond de Andrade",
            "description": "Educação infantil ao ensino médio",
            "jpegThumbnail": MINIATURA,
        }
    }
    p = previa_do_whatsapp(msg)
    assert p["kind"] == "link"
    assert p["url"] == "https://www.ccda.com.br"
    assert p["title"].startswith("CCDA")
    assert p["description"] == "Educação infantil ao ensino médio"
    assert p["thumb"] == "data:image/jpeg;base64," + MINIATURA


def test_sem_titulo_nao_tem_capinha():
    # o WhatsApp também não desenha capinha sem título
    assert previa_do_whatsapp({"extendedTextMessage": {"text": "https://x.com.br", "matchedText": "https://x.com.br"}}) is None
    assert previa_do_whatsapp({"conversation": "oi"}) is None
    assert previa_do_whatsapp(None) is None


def test_link_sem_esquema_ganha_https():
    p = previa_do_whatsapp({"extendedTextMessage": {"matchedText": "ccda.com.br", "title": "CCDA"}})
    assert p["url"] == "https://ccda.com.br"


def test_miniatura_gigante_fica_de_fora():
    grande = "A" * 100_000
    p = previa_do_whatsapp({"extendedTextMessage": {"matchedText": "https://a.com", "title": "A", "jpegThumbnail": grande}})
    assert p is not None and "thumb" not in p


def test_primeira_url_sem_pontuacao_colada():
    assert primeira_url("veja: https://ccda.com.br/matricula.") == "https://ccda.com.br/matricula"
    assert primeira_url("(www.ccda.com.br)") == "https://www.ccda.com.br"
    assert primeira_url("sem link aqui") is None


# ─── a capinha do envio só sai para a internet pública ─────────────────────


async def test_bloqueia_rede_interna():
    for url in (
        "http://127.0.0.1/",
        "http://10.0.1.37:5432/",
        "http://192.168.0.1/",
        "http://169.254.169.254/latest/meta-data/",  # metadados da nuvem
        "http://[::1]/",
        "http://localhost/",
        "file:///etc/passwd",
        "ftp://ccda.com.br/",
        "https://1.1.1.1:8443/",  # porta que não é web
    ):
        assert not await _url_permitida(url), url


async def test_libera_ip_publico():
    assert await _url_permitida("https://1.1.1.1/")


# ─── o que fica no histórico ────────────────────────────────────────────────


def test_midia_que_nao_baixou_entra_marcada():
    # 07/10: a foto chegava sem link e SUMIA do inbox — agora entra com o erro
    log = anexos_para_log([ConnectorAttachment(kind="image", url=None, mime="image/jpeg", erro="nao_baixada")])
    assert log == [{"kind": "image", "url": None, "mime": "image/jpeg", "erro": "nao_baixada"}]


def test_anexo_sem_link_e_sem_erro_continua_fora():
    assert anexos_para_log([ConnectorAttachment(kind="image")]) == []


def test_documento_guarda_o_nome_e_capinha_os_campos():
    log = anexos_para_log(
        [
            ConnectorAttachment(kind="document", url="https://r2/x.pdf", mime="application/pdf", name="boletim.pdf"),
            ConnectorAttachment(kind="link", url="https://ccda.com.br", title="CCDA", thumb="data:image/jpeg;base64,AA"),
        ]
    )
    assert log[0]["name"] == "boletim.pdf"
    assert log[1] == {"kind": "link", "url": "https://ccda.com.br", "mime": None, "title": "CCDA", "thumb": "data:image/jpeg;base64,AA"}


# ─── assinatura «*Nome:*» ───────────────────────────────────────────────────


def test_assinatura_usa_o_primeiro_nome_em_negrito():
    assert com_assinatura("Luciana Darla Ferreira", "Bom dia!") == "*Luciana:*\nBom dia!"
    assert primeiro_nome("  Ellaine ") == "Ellaine"


def test_sem_nome_nao_assina():
    assert com_assinatura(None, "Bom dia!") == "Bom dia!"
    assert com_assinatura("", "Bom dia!") == "Bom dia!"


def test_eco_assinado_volta_ao_texto_gravado():
    # o painel grava SEM o prefixo; o eco do celular volta COM ele
    assert tirar_assinatura(com_assinatura("Ellaine", "Boa tarde")) == "Boa tarde"
    # negrito no meio do texto não é assinatura
    assert tirar_assinatura("Confirma *sexta*:\nok") == "Confirma *sexta*:\nok"
