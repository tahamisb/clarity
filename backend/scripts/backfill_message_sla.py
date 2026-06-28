"""
One-off migration + backfill for SLA / agent-handover support.

Adds two columns to the text-sentiment `messages` table and backfills them from
the source `chat_history` table (joined on chat_id = message_id):

  • closed_at  — the conversation END time. Handling time is closed_at - created_at,
                 which is what the SLA logic measures (NOT now - created_at, and NOT
                 the meaningless ingested_at).
  • agent_name — the human agent who handled/closed the chat, taken from
                 chat_history.closed_by. System/automated closers (cron, Bot,
                 Customer, System) are treated as "no agent" (NULL) — i.e. the chat
                 was handled entirely by the bot or closed by the customer. A
                 non-null agent_name therefore marks a bot→agent handover.

Safe to re-run: ADD COLUMN IF NOT EXISTS + idempotent UPDATE.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from app.config import get_settings
from app.services.bq_client import get_client

s = get_settings()
client = get_client()

MESSAGES = f"`{s.gcp_project_id}.{s.bq_text_dataset}.messages`"
CHATS = f"`{s.gcp_project_id}.reports.chat_history`"

# Closers that are not human agents — these mean "no handover to an agent".
NON_AGENT_CLOSERS = "('cron', 'customer', 'bot', 'system', 'agent')"


def run() -> None:
    print("1) Adding columns (idempotent)…")
    client.query(f"""
        ALTER TABLE {MESSAGES}
        ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS agent_name STRING
    """).result()

    print("2) Backfilling closed_at + agent_name from chat_history…")
    # chat_history can hold more than one row per chat_id; collapse to one
    # (the latest by closed_at) so the UPDATE matches a single source row.
    job = client.query(f"""
        UPDATE {MESSAGES} m
        SET closed_at = ch.closed_at_ts,
            agent_name = CASE
                WHEN ch.closed_by IS NULL THEN NULL
                WHEN LOWER(TRIM(ch.closed_by)) IN {NON_AGENT_CLOSERS} THEN NULL
                ELSE ch.closed_by
            END
        FROM (
            SELECT chat_id_str, closed_at_ts, closed_by FROM (
                SELECT
                    CAST(chat_id AS STRING) AS chat_id_str,
                    TIMESTAMP(closed_at) AS closed_at_ts,
                    closed_by,
                    ROW_NUMBER() OVER (
                        PARTITION BY CAST(chat_id AS STRING)
                        ORDER BY closed_at DESC
                    ) AS rn
                FROM {CHATS}
            )
            WHERE rn = 1
        ) ch
        WHERE ch.chat_id_str = m.message_id
    """)
    job.result()
    print(f"   Rows backfilled: {job.num_dml_affected_rows}")

    print("3) Sanity check…")
    row = next(iter(client.query(f"""
        SELECT
          COUNT(*) AS total,
          COUNTIF(closed_at IS NOT NULL) AS with_closed,
          COUNTIF(agent_name IS NOT NULL) AS with_agent,
          COUNTIF(closed_at IS NOT NULL
                  AND TIMESTAMP_DIFF(closed_at, created_at, MINUTE) > 240) AS over_4h
        FROM {MESSAGES}
    """).result()))
    print(f"   {dict(row)}")


if __name__ == "__main__":
    run()
    print("Done.")
