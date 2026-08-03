from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Gemini
    gemini_api_key: str
    gemini_model: str = "gemini-3.5-flash"
    # Model for high-volume chat/message classification. Cheapest capable tier;
    # set to gemini-3.5-flash to match Pillar 01 if lite quality ever disappoints.
    gemini_classify_model: str = "gemini-3.1-flash-lite"
    # Gemini 3.x models reason ("think") by default at medium level and bill those
    # tokens as OUTPUT — on our tiny JSON classifications that was ~12x the cost of
    # the answer itself. minimal | low | medium | high.
    gemini_thinking_level: str = "minimal"
    gemini_concurrency: int = 5

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8001
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    log_level: str = "info"

    # Batch classification
    classify_batch_size: int = 10
    classify_batch_delay_s: float = 0.5

    # Waitlist notifications (see app/routers/waitlist.py). Leave smtp_host or
    # the credentials blank and signups are still stored — just not emailed.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""  # defaults to smtp_user
    waitlist_notify_to: str = "t.mutahir@gorafeeq.com"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
