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
from app.services import bq_chats as bqc
from app.services.text_classifier import classify_chat_messages
from app.utils.chat_cleaner import clean_chat_messages
from app.utils.helpers import derive_agent_name, derive_channel, utcnow_iso

async def run(batch_size: int, limit: int, dry_run: bool) -> None:
    settings = get_settings()
    logger.info("Fetching unprocessed chats from BigQuery (limit=%d)…", limit)
    
    chats = await bqc.fetch_unprocessed_chats(limit=limit)

    if not chats:
        logger.info("No unprocessed chats. Nothing to do.")
        return

    logger.info("Found %d unprocessed chats", len(chats))
    if dry_run:
        logger.info("[DRY RUN] Would process %d chats in batches of %d", len(chats), batch_size)
        return

    model_version = settings.gemini_model
    processed, skipped, failed = 0, 0, 0

    for i in range(0, len(chats), batch_size):
        batch = chats[i : i + batch_size]
        
        tasks = []
        valid_chats = []
        
        for chat in batch:
            chat_id = chat["chat_id"]
            messages_json = chat.get("messages")
            cleaned_text = clean_chat_messages(messages_json)
            
            if not cleaned_text:
                skipped += 1
                continue
                
            valid_chats.append((chat, cleaned_text))
            tasks.append(classify_chat_messages(cleaned_text))
            
        if not tasks:
            continue
            
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        good_msgs, good_clfs = [], []
        for (chat, cleaned_text), result in zip(valid_chats, results):
            chat_id = chat["chat_id"]
            if isinstance(result, Exception):
                logger.error("Failed chat %s: %s", chat_id, result)
                failed += 1
            else:
                channel = derive_channel(chat.get("type"), chat.get("device_id"))
                
                # We reuse chat_id as message_id for deduplication
                closed_at = chat.get("closed_at")
                good_msgs.append({
                    "message_id": chat_id,
                    "customer_id": chat.get("customer_id"),
                    "content": cleaned_text,
                    "source_channel": channel,
                    "merchant_name": chat.get("merchant_name"),
                    "zone": chat.get("zone"),
                    "created_at": str(chat.get("created_at", "")),
                    "ingested_at": utcnow_iso(),
                    "closed_at": str(closed_at) if closed_at else None,
                    "agent_name": derive_agent_name(chat.get("closed_by")),
                })
                
                good_clfs.append({
                    "classification_id": str(uuid.uuid4()),
                    "message_id": chat_id,
                    "sentiment": result["sentiment"],
                    "sentiment_confidence": result["sentiment_confidence"],
                    "intent": result["intent"],
                    "intent_confidence": result["intent_confidence"],
                    "negative_trigger": result["negative_trigger"],
                    "model_version": model_version,
                    "classified_at": utcnow_iso(),
                })
                processed += 1

        if good_msgs and good_clfs:
            try:
                await bq.insert_messages(good_msgs)
                await bq.insert_classifications(good_clfs)
            except Exception as exc:
                logger.error("BQ insert failed for batch: %s", exc)
                failed += len(good_msgs)
                processed -= len(good_msgs)

        logger.info("Progress: %d/%d — processed: %d, skipped: %d, failed: %d",
                    min(i + batch_size, len(chats)), len(chats), processed, skipped, failed)

        if i + batch_size < len(chats):
            await asyncio.sleep(settings.classify_batch_delay_s)

    logger.info("Done — processed: %d, skipped: %d, failed: %d", processed, skipped, failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(batch_size=args.batch_size, limit=args.limit, dry_run=args.dry_run))
