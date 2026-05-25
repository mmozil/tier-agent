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
    hermes_image: str = "tier/hermes:0.14.0-tier1"
    hermes_port_range_start: int = 7100
    hermes_port_range_end: int = 9100

    # SSH para orchestrar Docker no host (em vez de mountar /var/run/docker.sock)
    tier_agent_ssh_host: str = "46.224.220.223"
    tier_agent_ssh_user: str = "root"
    tier_agent_ssh_port: int = 22
    tier_agent_ssh_privkey_b64: str = ""

    tier_whatsapp_engine_url: str = "https://whats.tier.finance"
    tier_whatsapp_engine_admin_key: str = ""
    tier_whatsapp_webhook_secret: str = ""

    tier_pay_api_url: str = "https://api.tier.finance"
    tier_pay_internal_key: str = ""
    tier_agent_sku_starter_plan_id: str = ""
    tier_agent_sku_pro_plan_id: str = ""
    tier_agent_sku_business_plan_id: str = ""

    google_tts_api_key: str = ""
    google_tts_default_voice: str = "pt-BR-Wavenet-A"

    default_llm_provider: str = "minimax"
    default_llm_model: str = "MiniMax-M2"
    default_llm_api_key: str = ""

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
