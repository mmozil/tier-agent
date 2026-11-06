"""Leitura do caminho do lead na mensagem do WhatsApp.

As estruturas são as reais, gravadas pelo motor (`messages.raw_payload`), com os
campos enormes (miniatura) cortados."""

from services.origem_whatsapp import sem_invisiveis, sinal_de_origem

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
