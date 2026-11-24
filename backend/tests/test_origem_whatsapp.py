"""Leitura do caminho do lead na mensagem do WhatsApp.

As estruturas são as reais, gravadas pelo motor (`messages.raw_payload`), com os
campos enormes (miniatura) cortados."""

from services.origem_whatsapp import sem_invisiveis, sinal_de_origem, sinal_do_referral

ANUNCIO_INSTAGRAM = {
    "extendedTextMessage": {
        "text": "Olá! Posso ter mais informações sobre isso?",
        "contextInfo": {
            "externalAdReply": {
                "body": "Sua próxima semijoia favorita pode estar aqui",
                "title": "instagram.com",
                "ctwaClid": "AfjPnvLZ_cNhpinhoMmILuqX8clslOy",
                "sourceId": "120252695352530583",
                "mediaType": "IMAGE",
                "sourceApp": "instagram",
                "sourceUrl": "https://www.instagram.com/p/DZIn1NTDIXJ/",
            },
        },
    }
}

LINK = {
    "extendedTextMessage": {
        "text": "Ola",
        "contextInfo": {"entryPointConversionSource": "click_to_chat_link", "entryPointConversionDelaySeconds": 6},
    }
}

BUSCA = {
    "extendedTextMessage": {
        "text": "Bom dia",
        "contextInfo": {"entryPointConversionSource": "global_search_new_chat", "entryPointConversionApp": "whatsapp"},
    }
}

ENCAMINHADA = {
    "extendedTextMessage": {
        "text": "olha isso",
        "contextInfo": {"isForwarded": True, "forwardingScore": 1, "conversionSource": "FB_Ads"},
    }
}


def test_anuncio_traz_id_app_e_link():
    s = sinal_de_origem(ANUNCIO_INSTAGRAM)
    assert s["anuncio_id"] == "120252695352530583"
    assert s["anuncio_app"] == "instagram"
    assert s["anuncio_url"].endswith("/DZIn1NTDIXJ/")
    assert s["ctwa"] is True


def test_link_do_whatsapp():
    assert sinal_de_origem(LINK) == {"entrada": "click_to_chat_link"}


def test_quem_procurou_o_numero():
    assert sinal_de_origem(BUSCA) == {"entrada": "global_search_new_chat", "entrada_app": "whatsapp"}


def test_encaminhada_nao_conta_como_anuncio():
    assert sinal_de_origem(ENCAMINHADA) is None


def test_contexto_de_foto_tambem_vale():
    assert sinal_de_origem({"imageMessage": {"contextInfo": {"conversionSource": "FB_Ads"}}}) == {
        "conversao": "FB_Ads"
    }


def test_texto_simples_nao_tem_sinal():
    assert sinal_de_origem({"conversation": "oi"}) is None


def test_externalAdReply_vazio_nao_inventa_anuncio():
    assert sinal_de_origem({"extendedTextMessage": {"contextInfo": {"externalAdReply": {}}}}) is None


def test_entrada_invalida_nao_quebra():
    assert sinal_de_origem(None) is None
    assert sinal_de_origem({}) is None
    assert sinal_de_origem({"extendedTextMessage": {"contextInfo": {"externalAdReply": "x"}}}) is None


def test_invisiveis_nao_comem_o_corte_da_mensagem():
    bruto = "Olá, cheguei e gost" + "﻿‌​⁠" * 66 + "aria de tirar dúvidas"
    assert sem_invisiveis(bruto)[:300] == "Olá, cheguei e gostaria de tirar dúvidas"


# ─── número OFICIAL (Cloud API): a marca vem em `referral` ────────────────────
# O corpo é o real da conversa 2193 da M7 (card 31447, 24/11/2026), sem telefone e miniatura.

REFERRAL = {
    "from": "5511900000000",
    "type": "text",
    "text": {"body": "Olá! Tenho interesse e queria mais informações, por favor."},
    "referral": {
        "source_url": "https://www.instagram.com/p/DU6vl_rADMB/",
        "source_id": "120251987404330345",
        "source_type": "ad",
        "body": "O equilíbrio perfeito entre design, conforto e concentração.",
        "headline": "M7 Ambientes",
        "media_type": "video",
        "ctwa_clid": "AfjqKBoeI565DrJhuhoDh9CyrrkbZ",
        "welcome_message": {"text": "Oi! Como podemos ajudar?"},
    },
}


def test_oficial_traz_o_anuncio_no_mesmo_formato_do_motor():
    s = sinal_do_referral(REFERRAL)
    assert s == {
        "anuncio_id": "120251987404330345",
        "anuncio_app": "instagram",
        "anuncio_url": "https://www.instagram.com/p/DU6vl_rADMB/",
        "anuncio_texto": "O equilíbrio perfeito entre design, conforto e concentração.",
        "ctwa": True,
    }


def test_oficial_link_fb_me_nao_diz_o_aplicativo():
    ref = {**REFERRAL["referral"], "source_url": "https://fb.me/4ccYAYB4o"}
    s = sinal_do_referral({**REFERRAL, "referral": ref})
    assert "anuncio_app" not in s and s["anuncio_id"]


def test_oficial_facebook():
    ref = {**REFERRAL["referral"], "source_url": "https://www.facebook.com/m7ambientes/posts/1"}
    assert sinal_do_referral({"referral": ref})["anuncio_app"] == "facebook"


def test_oficial_publicacao_nao_vira_id_de_anuncio():
    ref = {"source_type": "post", "source_id": "999", "source_url": "https://www.instagram.com/p/x/"}
    s = sinal_do_referral({"referral": ref})
    assert "anuncio_id" not in s and "ctwa" not in s and s["publicacao"] is True


def test_oficial_sem_marca_nao_inventa():
    assert sinal_do_referral({"from": "1", "text": {"body": "oi"}}) is None
    assert sinal_do_referral({"referral": {}}) is None
    assert sinal_do_referral({"referral": "x"}) is None
    assert sinal_do_referral(None) is None


def test_oficial_sem_texto_do_anuncio_usa_o_titulo():
    ref = {**REFERRAL["referral"], "body": ""}
    assert sinal_do_referral({"referral": ref})["anuncio_texto"] == "M7 Ambientes"
