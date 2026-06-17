import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from app.services.bq_client import get_client

client = get_client()

sql = """
UPDATE `long-ceiling-343505.reports.messages` m
SET customer_id = CAST(ch.customer_id AS STRING),
    zone = vk.customer_zone,
    merchant_name = vk.restaurant_name
FROM `long-ceiling-343505.reports.chat_history` ch
LEFT JOIN `long-ceiling-343505.reports.vendor_kpi` vk ON ch.order_id = vk.id
WHERE CAST(ch.chat_id AS STRING) = m.message_id
"""

job = client.query(sql)
result = job.result()
print(f"Rows affected: {job.num_dml_affected_rows}")
