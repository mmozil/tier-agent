"""Passo 4 do Embedded Signup: ativar (register) o número só quando é seguro (11/11/2026)."""
import asyncio

from routes.connectors import ativar_numero_cloud


class _Resp:
    def __init__(self, status, data):
        self.status_code = status
        self._data = data
        self.text = str(data)

    def json(self):
        return self._data


class _Cli:
    def __init__(self, info, register_status=200):
        self.info = info
        self.register_status = register_status
        self.posts = []

    async def get(self, url, params=None, headers=None):
        return _Resp(200, self.info)

    async def post(self, url, json=None, headers=None):
        self.posts.append((url, json))
        return _Resp(self.register_status, {"success": self.register_status < 300})


def _rodar(cli, pin=None):
    # Mesmo padrão dos outros testes: asyncio.run() desarma o laço global e quebra os vizinhos.
    return asyncio.get_event_loop().run_until_complete(
        ativar_numero_cloud(cli, "https://g", "PID", "TOK", pin_existente=pin)
    )


def _info(plataforma, verif="VERIFIED"):
    return {"display_phone_number": "+55 11 99999-9591", "verified_name": "CCDA Diadema",
            "platform_type": plataforma, "code_verification_status": verif, "status": "PENDING"}


def test_numero_novo_verificado_e_ativado_com_pin_de_6_digitos():
    cli = _Cli(_info("NOT_APPLICABLE"))
    out = _rodar(cli)
    assert out["status"] == "connected"
    assert len(cli.posts) == 1 and cli.posts[0][0] == "https://g/PID/register"
    assert cli.posts[0][1]["messaging_product"] == "whatsapp"
    assert out["pin"] == cli.posts[0][1]["pin"] and len(out["pin"]) == 6 and out["pin"].isdigit()
    assert out["phone"] == "+55 11 99999-9591" and out["verified_name"] == "CCDA Diadema"


def test_numero_ja_na_cloud_api_nao_registra_de_novo():
    cli = _Cli(_info("CLOUD_API"))
    out = _rodar(cli, pin="123456")
    assert out["status"] == "connected" and out["pin"] == "123456"
    assert cli.posts == []


def test_numero_em_outra_plataforma_nunca_e_puxado():
    cli = _Cli(_info("ON_PREMISE"))
    out = _rodar(cli)
    assert out["status"] == "pending" and "outro provedor" in out["erro_ativacao"]
    assert cli.posts == []


def test_numero_sem_verificacao_nao_registra():
    cli = _Cli(_info("NOT_APPLICABLE", verif="NOT_VERIFIED"))
    out = _rodar(cli)
    assert out["status"] == "pending" and cli.posts == []


def test_meta_recusa_fica_pending_com_motivo():
    cli = _Cli(_info("NOT_APPLICABLE"), register_status=400)
    out = _rodar(cli)
    assert out["status"] == "pending" and "recusou" in out["erro_ativacao"]
    assert "pin" not in out


def test_reusa_o_pin_que_ja_existe():
    cli = _Cli(_info("NOT_APPLICABLE"))
    out = _rodar(cli, pin="654321")
    assert cli.posts[0][1]["pin"] == "654321" and out["pin"] == "654321"
