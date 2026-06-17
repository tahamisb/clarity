"""
Seed realistic sample text/chat messages into BigQuery for dev and testing.

Usage:
    cd backend
    python scripts/seed_text_messages.py
    python scripts/seed_text_messages.py --count 200
"""

import argparse
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from google.cloud import bigquery
from app.config import get_settings
from app.utils.helpers import preprocess

settings = get_settings()

MERCHANTS = [
    "McDonald's", "KFC", "Pizza Hut", "Hardee's", "Shake Shack",
    "The Burger Lab", "Nando's", "Applebee's", "Raising Cane's", "Five Guys",
]
ZONES = [
    "West Bay", "The Pearl", "Lusail", "Al Waab", "Msheireb",
    "C-Ring Road", "Madinat Khalifa", "Al Sadd", "Duhail", "Al Rayyan",
]
CHANNELS = ["app", "whatsapp", "ticket"]

NEGATIVE_EN = [
    "Where is my order?! It's been 2 hours and still nothing.",
    "The driver was extremely rude and left without knocking.",
    "I received the completely wrong order. This is unacceptable.",
    "My food arrived cold and the packaging was damaged.",
    "I've been waiting over 90 minutes with no update.",
    "Missing items from my order and nobody is responding.",
    "I was charged twice — please refund me immediately.",
    "App crashed during checkout and still charged my card.",
    "Driver cannot find my address even though it's on the map.",
    "Order marked delivered but I never received anything!",
]
POSITIVE_EN = [
    "Excellent service! Food arrived hot and right on time.",
    "The driver was very polite and professional. Great experience.",
    "Best delivery I've had. Food was perfect. Thank you!",
    "Super fast delivery! 25 minutes ahead of schedule.",
    "Driver was friendly, food was amazing. 5 stars!",
]
NEUTRAL_EN = [
    "I want to cancel my order please.",
    "What is the status of order #45821?",
    "I'd like a refund for order 38291.",
    "Can I change the delivery address for my current order?",
    "How long does delivery to The Pearl usually take?",
]
ARABIC = [
    ("أين طلبي؟ مضى أكثر من ساعة ولم يصل بعد", "negative"),
    ("السائق وقح جداً ولم يستجب لمكالماتي", "negative"),
    ("استلمت طلباً خاطئاً بالكامل، هذا غير مقبول", "negative"),
    ("شكراً جزيلاً! الطلب وصل سريعاً والطعام كان لذيذاً", "positive"),
    ("السائق كان مؤدباً جداً وخدمة ممتازة", "positive"),
    ("أريد إلغاء طلبي من فضلك", "neutral"),
    ("ما هي حالة الطلب رقم ٤٥٨٢١؟", "neutral"),
]


def _rand_ts(days_back: int = 90) -> str:
    delta = timedelta(seconds=random.randint(0, days_back * 86400))
    return (datetime.now(timezone.utc) - delta).isoformat()


def generate(count: int) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for _ in range(count):
        if random.random() < 0.6:
            category = random.choices(["negative", "positive", "neutral"], weights=[50, 30, 20], k=1)[0]
            pool = {"negative": NEGATIVE_EN, "positive": POSITIVE_EN, "neutral": NEUTRAL_EN}
            content = random.choice(pool[category])
        else:
            content, _ = random.choice(ARABIC)
        rows.append({
            "message_id": str(uuid.uuid4()),
            "content": preprocess(content),
            "source_channel": random.choice(CHANNELS),
            "merchant_name": random.choice(MERCHANTS),
            "zone": random.choice(ZONES),
            "created_at": _rand_ts(),
            "ingested_at": now,
        })
    return rows


def seed(count: int) -> None:
    client = bigquery.Client(project=settings.gcp_project_id)
    table_id = f"{settings.gcp_project_id}.{settings.bq_text_dataset}.messages"
    rows = generate(count)
    inserted = 0
    for i in range(0, len(rows), 100):
        batch = rows[i : i + 100]
        errors = client.insert_rows_json(table_id, batch)
        if errors:
            print(f"  [ERROR] batch {i // 100 + 1}: {errors}")
        else:
            inserted += len(batch)
            print(f"  Batch {i // 100 + 1}: {len(batch)} rows — total: {inserted}")
    print(f"\nDone. {inserted}/{count} messages seeded into {table_id}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=100)
    args = parser.parse_args()
    print(f"Seeding {args.count} messages into {settings.gcp_project_id}.{settings.bq_text_dataset}.messages…")
    seed(args.count)
