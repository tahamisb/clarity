"""Connection and run settings, all from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    dsn: str
    seed: int

    @classmethod
    def from_env(cls) -> "Settings":
        dsn = os.environ.get("POSTGRES_DSN")
        if not dsn:
            # Assemble from parts so a local `python -m sim` run works off the
            # same .env the compose stack uses.
            user = os.environ.get("POSTGRES_USER", "sim_writer")
            password = os.environ.get("POSTGRES_PASSWORD", "")
            host = os.environ.get("POSTGRES_HOST", "127.0.0.1")
            port = os.environ.get("POSTGRES_PORT", "5432")
            db = os.environ.get("POSTGRES_DB", "warehouse")
            if not password:
                raise SystemExit(
                    "No POSTGRES_DSN and no POSTGRES_PASSWORD — "
                    "source warehouse/.env or pass --dsn."
                )
            dsn = f"postgresql://{user}:{password}@{host}:{port}/{db}"
        return cls(dsn=dsn, seed=int(os.environ.get("SIM_SEED", "20260728")))
