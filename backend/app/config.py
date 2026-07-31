from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=(),
    )

    database_url: str = "postgresql+asyncpg://arena:arena@localhost:5433/arena"

    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_site_url: str | None = "http://localhost:5173"
    openrouter_app_name: str = "Agent Arena"

    run_concurrency: int = 6
    request_timeout_s: float = 300.0
    catalog_ttl_minutes: int = 60

    # Agent sandbox
    docker_binary: str = "docker"
    sandbox_image: str = "agent-arena-sandbox:latest"
    sandbox_startup_timeout_s: float = 180.0
    sandbox_build_timeout_s: float = 900.0
    # Agent runs spin up a container each -- less parallel than one-shot runs.
    agent_concurrency: int = 3

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
