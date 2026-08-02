"""
Data exploration for cancellations — materialises the artifact JSONs consumed by
the API and the Gemini drivers report.

Reuses the exact query functions from `app.services.cancellation_service` so the
exploration outputs and the live `/api/cancellation/analytics/*` endpoints can
never drift apart.

Usage:
    cd backend
    python scripts/explore_cancellations.py
    python scripts/explore_cancellations.py --with-report   # also regenerate Gemini report
"""

import argparse
import asyncio
import json
import logging
import sys
import warnings
from pathlib import Path

# Silence the transitive pkg_resources DeprecationWarning from ML libs (scoped).
warnings.filterwarnings("ignore", message=r".*pkg_resources is deprecated.*", category=DeprecationWarning)

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

from app.services import cancellation_service as svc


def run(with_report: bool) -> None:
    logger.info("Running cancellation exploration queries against the local warehouse…")
    written = svc.write_exploration_artifacts()
    for name in written:
        path = svc.ARTIFACTS_DIR / name
        try:
            size = len(json.loads(path.read_text(encoding="utf-8")))
        except Exception:  # noqa: BLE001
            size = "?"
        logger.info("  ✓ %-40s (%s top-level entries)", name, size)

    logger.info("Wrote %d/%d exploration files to %s", len(written), len(svc.EXPLORATION_FUNCS), svc.ARTIFACTS_DIR)

    if with_report:
        logger.info("Regenerating Gemini drivers report…")
        report = asyncio.run(svc.generate_drivers_report())
        logger.info("  ✓ drivers report — %d drivers, %d segments",
                    len(report.get("top_drivers", [])), len(report.get("high_risk_segments", [])))

    logger.info("Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate cancellation exploration artifacts.")
    parser.add_argument("--with-report", action="store_true", help="Also regenerate the Gemini drivers report.")
    args = parser.parse_args()
    run(with_report=args.with_report)
