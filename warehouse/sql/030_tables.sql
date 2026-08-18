-- The warehouse tables.
--
-- Table and column names are kept EXACTLY as the products read them today,
-- including the `since_create_til_delivred_min` typo — they mirror the
-- organisation's real BigQuery columns, so renaming now means renaming back
-- later. What does change is the types: SQLite forced TEXT timestamps, REAL
-- money, INTEGER booleans and comma-joined arrays. Postgres gets the real
-- thing, and `compat` re-renders the legacy shapes for readers that still
-- expect them.
--
-- Timezone convention, inherited from the source data and preserved
-- deliberately: order placement is recorded in QATAR LOCAL time (a naive
-- date + time pair), while chat/message/call timestamps are UTC. `placed_at`
-- reconciles the two into one real instant.

SET search_path = warehouse, public;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE vendor_kpi (
    id                                bigint PRIMARY KEY,
    vendor_id                         integer      NOT NULL,
    customer_id                       bigint       NOT NULL,
    order_status                      text         NOT NULL,

    -- Qatar-local calendar fields, exactly as the source system records them.
    order_placement_date              date         NOT NULL,
    order_placement_time              time         NOT NULL,
    -- The same moment as a real instant (Asia/Qatar → UTC). Not in the source
    -- warehouse; added because every time-series query and the live ticker
    -- need an orderable, indexable timestamp.
    placed_at                         timestamptz  NOT NULL,

    total_order_value                 numeric(10,2),
    order_sub_total_value             numeric(10,2),
    delivery_charge                   numeric(10,2),
    vendor_to_customer_dist           numeric(6,2),
    driver_vendor_dist                numeric(6,2),

    is_pre_order                      boolean,
    new_customer                      boolean,
    is_pro_user                       boolean,
    is_pro_vendor                     boolean,
    is_treasure                       boolean,
    is_discount                       boolean,

    used_coupon                       text,
    payment_type                      text,
    customer_device_type              text,
    platform_name                     text,
    cuisine                           text,
    zone_name                         text,
    customer_zone                     text,
    restaurant_name                   text,
    location                          text,

    clarity_time_to_accept_order_min  numeric(6,1),
    vendor_to_accept_order_min        numeric(6,1),
    preparing_time_min                numeric(6,1),
    since_create_til_delivred_min     numeric(6,1),   -- [sic] mirrors the source column

    cancel_comment                    text,
    cancelled_by_txt                  text,
    cancelled_by_int                  smallint,

    feedback_order_rating             numeric(2,1),
    feedback_delivery_rating          numeric(2,1),
    feedback_comment                  text,

    -- Simulator bookkeeping. NULL on seeded history, set on live-ticked rows,
    -- so a demo can always answer "which of this is arriving right now?".
    sim_emitted_at                    timestamptz
);

COMMENT ON COLUMN vendor_kpi.placed_at IS
    'order_placement_date + order_placement_time interpreted as Asia/Qatar. Derived, not in the source warehouse.';

CREATE TABLE vendor_items_kpi (
    id           bigserial PRIMARY KEY,
    order_id     bigint NOT NULL REFERENCES vendor_kpi(id) ON DELETE CASCADE,
    product_name text,
    cat_name     text,
    "count"      integer,
    total_value  numeric(10,2)
);

-- ---------------------------------------------------------------------------
-- Support conversations
-- ---------------------------------------------------------------------------

CREATE TABLE chat_history (
    chat_id       bigint PRIMARY KEY,
    customer_id   bigint,
    order_id      bigint,
    type          text,
    device_id     text,
    locale        text,
    messages      jsonb,          -- [{from, text}, …] — was a JSON string
    created_at    timestamptz,
    closed_at     timestamptz,
    closed_by     text,
    is_phone_call boolean
);

CREATE TABLE messages (
    message_id     text PRIMARY KEY,
    customer_id    text,
    content        text,
    source_channel text,
    merchant_name  text,
    zone           text,
    created_at     timestamptz,
    ingested_at    timestamptz,
    closed_at      timestamptz,    -- NULL = still open (drives the SLA views)
    agent_name     text,
    sim_emitted_at timestamptz
);

CREATE TABLE classifications (
    classification_id    text PRIMARY KEY,
    message_id           text REFERENCES messages(message_id) ON DELETE CASCADE,
    sentiment            text,
    sentiment_confidence real,
    intent               text,
    intent_confidence    real,
    negative_trigger     text,
    model_version        text,
    classified_at        timestamptz
);

-- Human ground truth for the model-accuracy endpoint.
CREATE TABLE labels (
    message_id     text PRIMARY KEY REFERENCES messages(message_id) ON DELETE CASCADE,
    true_sentiment text,
    true_intent    text,
    labelled_by    text,
    labelled_at    timestamptz
);

CREATE TABLE skipped_chats (
    chat_id    text PRIMARY KEY,
    reason     text,
    skipped_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------

CREATE TABLE call_analysis (
    call_id              uuid PRIMARY KEY,
    transcript           text,
    -- These five were JSON-encoded strings under SQLite and are json.loads()'d
    -- by the app. jsonb keeps that contract while making them queryable.
    intents              jsonb,
    order_ids            jsonb,
    restaurant_names     jsonb,
    areas                jsonb,
    product_names        jsonb,
    qar_amounts          jsonb,
    primary_intent       text,
    sentiment            text,
    sentiment_confidence real,
    summary              text,
    -- Why the customer called, as a short phrase. Added after the first
    -- schema shipped; rows analysed before it exists fall back to a
    -- reason derived from the summary (call_analytics_service).
    call_reason          text,
    analysed_at          timestamptz,
    sim_emitted_at       timestamptz
);

-- ---------------------------------------------------------------------------
-- Model output
-- ---------------------------------------------------------------------------

-- No primary key existed under SQLite; an order can legitimately be re-scored,
-- so the natural key is (order_id, predicted_at) and the surrogate id keeps
-- re-scoring cheap.
CREATE TABLE cancellation_predictions (
    id                 bigserial PRIMARY KEY,
    order_id           text NOT NULL,
    engine             text,
    probability        real,
    risk_level         text,
    flagged            boolean,
    threshold          real,
    top_risk_factors   jsonb,
    gemini_explanation text,
    recommended_action text,
    restaurant_name    text,
    zone_name          text,
    predicted_at       timestamptz,
    -- Engine is part of the key: the scorecard and the trained model can
    -- legitimately score the same order at the same instant, and keying on
    -- (order_id, predicted_at) alone makes the second one a constraint
    -- violation rather than a second opinion.
    UNIQUE (order_id, engine, predicted_at)
);

-- ---------------------------------------------------------------------------
-- Product-owned runtime data — not warehouse content
-- ---------------------------------------------------------------------------

CREATE TABLE app.waitlist (
    id         bigserial PRIMARY KEY,
    email      text NOT NULL,
    company    text,
    note       text,
    plan       text,
    created_at timestamptz NOT NULL DEFAULT now()
);
