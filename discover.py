from google.cloud import bigquery
bq = bigquery.Client(project="long-ceiling-343505")

print("=== 1. Total non-phone-call chats ===")
r = list(bq.query(
    "SELECT COUNT(*) as cnt FROM `long-ceiling-343505.reports.chat_history` WHERE is_phone_call = FALSE OR is_phone_call IS NULL"
).result())
print(r[0]["cnt"])

print()
print("=== 2. Sample messages column ===")
rows = list(bq.query(
    "SELECT chat_id, messages FROM `long-ceiling-343505.reports.chat_history` LIMIT 3"
).result())
for row in rows:
    print(f"chat_id={row['chat_id']}")
    print(f"messages (first 600 chars): {str(row['messages'])[:600]}")
    print()

print("=== 3. Zones in vendor_kpi ===")
zones = list(bq.query(
    "SELECT DISTINCT customer_zone, COUNT(*) as cnt FROM `long-ceiling-343505.reports.vendor_kpi` GROUP BY customer_zone ORDER BY cnt DESC LIMIT 20"
).result())
for z in zones:
    print(f"  {z['customer_zone']}: {z['cnt']}")

print()
print("=== 4. Chats with matching vendor_kpi zone ===")
r2 = list(bq.query("""
    SELECT COUNT(*) as cnt FROM `long-ceiling-343505.reports.chat_history` ch
    JOIN `long-ceiling-343505.reports.vendor_kpi` vk ON ch.order_id = vk.id
    WHERE ch.is_phone_call = FALSE OR ch.is_phone_call IS NULL
""").result())
print(r2[0]["cnt"])

print()
print("=== 5. vendor_kpi column names ===")
cols = list(bq.query("""
    SELECT column_name, data_type FROM `long-ceiling-343505.reports.INFORMATION_SCHEMA.COLUMNS`
    WHERE table_name = 'vendor_kpi' AND column_name IN ('id', 'customer_zone', 'order_id')
""").result())
for c in cols:
    print(f"  {c['column_name']}: {c['data_type']}")
