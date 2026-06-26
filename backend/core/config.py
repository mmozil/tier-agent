from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    app_host: str = "0.0.0.0"
    app_port: int = 8100

    database_url: str
    db_pool_size: int = 10
    db_pool_overflow: int = 20

    redis_url: str = "redis://localhost:6379/3"

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_ttl_hours: int = 24

    fernet_key: str = Field(min_length=32)

    tier_sso_cookie_domain: str = ".tier.finance"
    tier_sso_cookie_name: str = "tier_session"

    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_endpoint: str = ""
    r2_bucket_name: str = "tier-agent"
    r2_public_url: str = ""

    docker_host: str = "unix:///var/run/docker.sock"
    engine_image: str = "tier/engine:0.14.0-tier1"
    engine_port_range_start: int = 7100
    engine_port_range_end: int = 9100

    # SSH para orchestrar Docker no host (em vez de mountar /var/run/docker.sock)
    tier_agent_ssh_host: str = "46.224.220.223"
    tier_agent_ssh_user: str = "root"
    tier_agent_ssh_port: int = 22
    tier_agent_ssh_privkey_b64: str = ""

    tier_whatsapp_engine_url: str = "https://whats.tier.finance"
    tier_whatsapp_engine_admin_key: str = ""
    tier_whatsapp_engine_tenant_id: str = ""
    tier_whatsapp_webhook_secret: str = ""

    # DevOps/Observability do agente DevSecOps
    # Webhook que recebe alertas dos guards do servidor (scan-guard/C&C-guard/ingress-guard)
    # e grava em ta_incident. HMAC-SHA256 do body, header X-Secops-Signature.
    tier_secops_webhook_secret: str = ""
    # Empresa/canal pra onde empurrar o alerta em tempo real (push WhatsApp). Opcional.
    tier_secops_alert_agent_id: int = 0
    tier_secops_alert_chat: str = ""
    # Prometheus HTTP API pro comando `infra` (CPU/RAM/disco do host). Vazio = comando degrada.
    tier_infra_prom_url: str = ""

    # Pet → Tier Agent: o Hovio Pet envia status do atendimento (check-in/etapas/pronto)
    # PELA instância WhatsApp do agente (Yanna), sem duplicar a credencial da Engine.
    pet_status_internal_key: str = ""
    pet_status_agent_id: int = 0

    tier_pay_api_url: str = "https://api.tier.finance"
    tier_pay_internal_key: str = ""
    tier_agent_sku_starter_plan_id: str = ""
    tier_agent_sku_pro_plan_id: str = ""
    tier_agent_sku_business_plan_id: str = ""

    google_tts_api_key: str = ""
    google_tts_default_voice: str = "pt-BR-Wavenet-A"

    google_client_id: str = ""
    google_client_secret: str = ""

    default_llm_provider: str = "minimax"
    default_llm_model: str = "MiniMax-M2"
    default_llm_api_key: str = ""

    # OAuth client do Tier Agent no servidor OAuth do Tier (federação MCP —
    # fluxo Conectar→Autorizar sem token manual). Secret vem do env Coolify.
    tier_oauth_client_id: str = "tier-agent"
    tier_oauth_client_secret: str = ""
    tier_oauth_redirect_uri: str = "https://agent.tier.finance/integracoes/tier/callback"

    # Integração ERP (Tier Empresas) ↔ Agent: shared secret pros endpoints
    # /integrations/tier/provision + /sso (provisiona tenant + SSO sem 2º login).
    # Vazio = integração desligada (endpoints respondem 503). Setar nos 2 lados (Coolify).
    tier_erp_integration_secret: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
