"""
Batch-classify all unprocessed text messages in BigQuery.

Already-classified messages are skipped automatically — safe to re-run.

Usage:
    cd backend
    python scripts/run_batch_classify.py
    python scripts/run_batch_classify.py --batch-size 20 --limit 1000
    python scripts/run_batch_classify.py --dry-run
"""

import argparse
import asyncio
import logging
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger(__name__)

from app.config import get_settings
from app.services import bq_text as bq
from app.services.text_classifier import classify_message
from app.utils.helpers import utcnow_iso


async def run(batch_size: int, limit: int, dry_run: bool) -> None:
    settings = get_settings()
    logger.info("Fetching unclassified message IDs (limit=%d)…", limit)
    ids = await bq.get_unclassified_message_ids(limit=limit)

    if not ids:
        logger.info("No unclassified messages. Nothing to do.")
        return

    logger.info("Found %d unclassified messages", len(ids))
    if dry_run:
        logger.info("[DRY RUN] Would classify %d messages in batches of %d", len(ids), batch_size)
        return

    model_version = settings.gemini_model
    classified, failed_ids = 0, []

    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        messages = await bq.get_messages_by_ids(batch)
        msg_map = {m["message_id"]: m["content"] for m in messages}

        tasks, valid = [], []
        for mid in batch:
            content = msg_map.get(mid)
            if not content:
                failed_ids.append(mid)
                continue
            valid.append(mid)
            tasks.append(classify_message(content))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        good: list[dict] = []
        for mid, r in zip(valid, results):
            if isinstance(r, Exception):
                logger.error("Failed %s: %s", mid, r)
                failed_ids.append(mid)
            else:
                good.append({"classification_id": str(uuid.uuid4()), "message_id": mid,
                              **r, "model_version": model_version, "classified_at": utcnow_iso()})
                classified += 1

        if good:
            try:
                await bq.insert_classifications(good)
            except Exception as exc:
                logger.error("BQ insert failed: %s", exc)
                failed_ids.extend(r["message_id"] for r in good)
                classified -= len(good)

        logger.info("Progress: %d/%d — classified: %d, failed: %d",
                    min(i + batch_size, len(ids)), len(ids), classified, len(failed_ids))

        if i + batch_size < len(ids):
            await asyncio.sleep(settings.classify_batch_delay_s)

    logger.info("Done — total: %d, classified: %d, failed: %d", len(ids), classified, len(failed_ids))
    if failed_ids:
        logger.warning("Failed IDs: %s", failed_ids)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(batch_size=args.batch_size, limit=args.limit, dry_run=args.dry_run))
