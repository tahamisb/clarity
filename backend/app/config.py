from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Gemini
    gemini_api_key: str
    gemini_model: str = "gemini-3.5-flash"
    gemini_concurrency: int = 5

    # Google Cloud
    gcp_project_id: str = "long-ceiling-343505"
    bq_calls_dataset: str = "reports"       # Pillar 01 — call_analysis, vendor_kpi, vendor_items_kpi
    bq_text_dataset: str = "reports" # Pillar 02 — messages, classifications, labels (same dataset as chat_history)
    # Safety cap: BigQuery rejects any (non-parametrized) query that would scan
    # more than this, so a bad WHERE/JOIN can't silently bill the whole warehouse.
    bq_max_bytes_billed: int = 50 * 1024**3  # 50 GiB

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    log_level: str = "info"

    # Batch classification
    classify_batch_size: int = 10
    classify_batch_delay_s: float = 0.5

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
