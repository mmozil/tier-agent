"""Testes de unidade dos helpers do envio proativo (A2) — lógica pura, sem banco."""

from services.proactive import _rate_buckets, check_rate_limit, normalize_phone


def test_normalize_phone_aceita_digitos_com_ddi():
    assert normalize_phone("5511999999999") == "5511999999999"
    assert normalize_phone("+55 (11) 99999-9999") == "5511999999999"
    assert normalize_phone("11 3222-1100") == "1132221100"  # 10 dígitos (fixo sem DDI) ainda passa


def test_normalize_phone_rejeita_invalido():
    assert normalize_phone("") is None
    assert normalize_phone(None) is None
    assert normalize_phone("123") is None
    assert normalize_phone("1" * 16) is None  # acima do teto E.164


def test_rate_limit_30_por_minuto():
    tenant = 987_001
    _rate_buckets.pop(tenant, None)
    t0 = 1000.0
    for i in range(30):
        assert check_rate_limit(tenant, now=t0 + i * 0.5) is True
    # 31º dentro da mesma janela → bloqueia
    assert check_rate_limit(tenant, now=t0 + 20.0) is False


def test_rate_limit_janela_desliza():
    tenant = 987_002
    _rate_buckets.pop(tenant, None)
    t0 = 2000.0
    for i in range(30):
        assert check_rate_limit(tenant, now=t0 + i) is True
    assert check_rate_limit(tenant, now=t0 + 30) is False
    # 61s depois do primeiro envio, o slot mais antigo expira → libera 1
    assert check_rate_limit(tenant, now=t0 + 61) is True


def test_rate_limit_por_tenant_isolado():
    a, b = 987_003, 987_004
    _rate_buckets.pop(a, None)
    _rate_buckets.pop(b, None)
    for i in range(30):
        assert check_rate_limit(a, now=3000.0 + i * 0.1) is True
    assert check_rate_limit(a, now=3005.0) is False
    assert check_rate_limit(b, now=3005.0) is True  # outro tenant não é afetado
