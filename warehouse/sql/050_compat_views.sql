-- Compatibility views — the integration seam.
--
-- The products currently read a SQLite file where every timestamp is the TEXT
-- 'YYYY-MM-DD HH:MM:SS', every boolean is 0/1, every money value is a float
-- and every array is a JSON string. These views re-render the properly-typed
-- warehouse tables in exactly those shapes, so a backend can switch from
-- SQLite to Postgres WITHOUT rewriting a single query or changing the JSON it
-- puts on the wire.
--
-- Set `search_path = compat, warehouse, public` on the reader role and every
-- unqualified `FROM messages` resolves here.
--
-- These are temporary. Once each product migrates to native types, drop the
-- view and point it at `warehouse` directly. When the REAL warehouse arrives,
-- this schema is also where its column mapping goes — which is why the seam is
-- worth having even though today's views are nearly pass-through.
--
-- Timestamps render in UTC, matching how the source data was stored.

SET search_path = compat, warehouse, public;

CREATE OR REPLACE VIEW compat.vendor_kpi AS
SELECT
    id,
    vendor_id,
    customer_id,
    order_status,
    to_char(order_placement_date, 'YYYY-MM-DD')      AS order_placement_date,
    to_char(order_placement_time, 'HH24:MI:SS')      AS order_placement_time,
    total_order_value::double precision              AS total_order_value,
    order_sub_total_value::double precision          AS order_sub_total_value,
    delivery_charge::double precision                AS delivery_charge,
    vendor_to_customer_dist::double precision        AS vendor_to_customer_dist,
    driver_vendor_dist::double precision             AS driver_vendor_dist,
    is_pre_order::int                                AS is_pre_order,
    new_customer::int                                AS new_customer,
    is_pro_user::int                                 AS is_pro_user,
    is_pro_vendor::int                               AS is_pro_vendor,
    is_treasure::int                                 AS is_treasure,
    is_discount::int                                 AS is_discount,
    used_coupon,
    payment_type,
    customer_device_type,
    platform_name,
    cuisine,
    zone_name,
    customer_zone,
    restaurant_name,
    location,
    clarity_time_to_accept_order_min::double precision AS clarity_time_to_accept_order_min,
    vendor_to_accept_order_min::double precision       AS vendor_to_accept_order_min,
    preparing_time_min::double precision               AS preparing_time_min,
    since_create_til_delivred_min::double precision    AS since_create_til_delivred_min,
    cancel_comment,
    cancelled_by_txt,
    cancelled_by_int::int                            AS cancelled_by_int,
    feedback_order_rating::double precision          AS feedback_order_rating,
    feedback_delivery_rating::double precision       AS feedback_delivery_rating,
    feedback_comment
FROM warehouse.vendor_kpi;

CREATE OR REPLACE VIEW compat.vendor_items_kpi AS
SELECT
    order_id,
    product_name,
    cat_name,
    "count",
    total_value::double precision AS total_value
FROM warehouse.vendor_items_kpi;

CREATE OR REPLACE VIEW compat.chat_history AS
SELECT
    chat_id,
    customer_id,
    order_id,
    type,
    device_id,
    locale,
    messages::text                                              AS messages,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
    to_char(closed_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS closed_at,
    closed_by,
    is_phone_call::int                                          AS is_phone_call
FROM warehouse.chat_history;

CREATE OR REPLACE VIEW compat.messages AS
SELECT
    message_id,
    customer_id,
    content,
    source_channel,
    merchant_name,
    zone,
    to_char(created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS created_at,
    to_char(ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ingested_at,
    to_char(closed_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS closed_at,
    agent_name
FROM warehouse.messages;

CREATE OR REPLACE VIEW compat.classifications AS
SELECT
    classification_id,
    message_id,
    sentiment,
    sentiment_confidence,
    intent,
    intent_confidence,
    negative_trigger,
    model_version,
    to_char(classified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS classified_at
FROM warehouse.classifications;

CREATE OR REPLACE VIEW compat.labels AS
SELECT
    message_id,
    true_sentiment,
    true_intent,
    labelled_by,
    to_char(labelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS labelled_at
FROM warehouse.labels;

CREATE OR REPLACE VIEW compat.skipped_chats AS
SELECT
    chat_id,
    reason,
    to_char(skipped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS skipped_at
FROM warehouse.skipped_chats;

CREATE OR REPLACE VIEW compat.call_analysis AS
SELECT
    call_id::text            AS call_id,
    transcript,
    intents::text            AS intents,
    primary_intent,
    sentiment,
    sentiment_confidence,
    order_ids::text          AS order_ids,
    restaurant_names::text   AS restaurant_names,
    areas::text              AS areas,
    product_names::text      AS product_names,
    qar_amounts::text        AS qar_amounts,
    summary,
    to_char(analysed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS analysed_at
FROM warehouse.call_analysis;

CREATE OR REPLACE VIEW compat.cancellation_predictions AS
SELECT
    order_id,
    engine,
    probability,
    risk_level,
    flagged::int           AS flagged,
    threshold,
    top_risk_factors::text AS top_risk_factors,
    gemini_explanation,
    recommended_action,
    restaurant_name,
    zone_name,
    to_char(predicted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS predicted_at
FROM warehouse.cancellation_predictions;
