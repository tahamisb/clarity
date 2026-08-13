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

    # Warehouse. `sqlite` reads the frozen data/clarity.db snapshot; `postgres`
    # reads the simulated live warehouse (see warehouse/README.md). The SQL is
    # the same either way — app/services/warehouse.py explains how.
    warehouse_backend: str = "sqlite"
    database_url: str = ""
    # NB the SQLite file location is read from $SQLITE_PATH by local_db
    # directly, not declared here: that module has to stay importable without
    # pydantic-settings so the simulator can reuse its UDF shims.
    # FastAPI runs the synchronous reads on its threadpool, so concurrent
    # queries are the norm and a pool is required rather than nice to have.
    warehouse_pool_min: int = 2
    warehouse_pool_max: int = 10
    warehouse_connect_timeout_s: float = 10.0

    # Clock (app/utils/clock.py). `auto` freezes on the sqlite snapshot, whose
    # data stops on a fixed day, and runs live against the Postgres warehouse,
    # which does not. Force it with live|frozen for an offline demo.
    clock_mode: str = "auto"
    clock_frozen_at: str = ""  # ISO instant; blank uses the snapshot's last day

    # The operator's timezone. Storage is UTC; "today", the hour-of-day
    # buckets and the demand-curve peaks are all business-local. The SQLite
    # snapshot predates this and stores local time labelled as UTC, so it is
    # left on UTC — see docs/live-data-simulation.md.
    business_timezone: str = "UTC"

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8001
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    log_level: str = "info"

    # Batch classification
    classify_batch_size: int = 10
    classify_batch_delay_s: float = 0.5

    # Live AI pipeline (app/services/live_pipeline.py). Classifies and scores
    # rows as the warehouse receives them, instead of reading pre-baked
    # results. Runs only against a live warehouse.
    live_pipeline_enabled: bool = True
    classify_interval_s: float = 20.0
    # Hard daily cap on model calls. The simulator produces messages forever,
    # so an uncapped worker is an uncapped bill; past the cap the deterministic
    # fallback takes over and the dashboard keeps working.
    classify_daily_budget: int = 2000
    score_interval_s: float = 60.0
    score_batch_size: int = 100

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
