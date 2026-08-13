-- Simulator control state. Products never read this schema.

SET search_path = sim, public;

-- Single-row table (enforced by the CHECK) holding where the simulation is up
-- to. On boot the ticker reads this and backfills the gap, so a restarted
-- container does not leave a visible dent in the charts.
CREATE TABLE sim.tick_cursor (
    only_row     boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    last_tick_at timestamptz,
    seeded_from  timestamptz,
    seeded_to    timestamptz,
    generator    text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sim.tick_cursor (only_row) VALUES (true);

-- ID allocation. The seeder and the live ticker both mint order/chat/message
-- ids and must never collide, so both draw from these sequences rather than
-- from max(id) + 1 (which races and breaks after a retention prune).
CREATE SEQUENCE sim.order_id_seq    START 500000;
CREATE SEQUENCE sim.chat_id_seq     START 900000;
CREATE SEQUENCE sim.message_seq     START 1;
CREATE SEQUENCE sim.classification_seq START 1;

-- Demo scenarios: a row here bends the simulation while it is active.
--
--   merchant_outage       accept times blow up and cancellations spike for one merchant
--   zone_courier_shortage delivery times and 'No driver available' surge in one zone
--   sentiment_storm       negative-trigger rate jumps on one channel
--   volume_spike          demand multiplier (match day, weather)
--
-- Trigger one mid-demo and the negative-trend card, the zone heatmap and the
-- risk queue all react on their own a minute or two later.
CREATE TABLE sim.scenarios (
    id           bigserial PRIMARY KEY,
    kind         text        NOT NULL CHECK (kind IN (
                     'merchant_outage', 'zone_courier_shortage',
                     'sentiment_storm', 'volume_spike')),
    target       text,                       -- merchant / zone / channel; NULL = platform-wide
    magnitude    numeric(5,2) NOT NULL DEFAULT 2.0,
    starts_at    timestamptz  NOT NULL DEFAULT now(),
    ends_at      timestamptz  NOT NULL,
    note         text,
    created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX scenarios_active_idx ON sim.scenarios (starts_at, ends_at);

CREATE VIEW sim.active_scenarios AS
SELECT * FROM sim.scenarios WHERE now() BETWEEN starts_at AND ends_at;

-- The lifecycle plan for every in-flight order.
--
-- An order's whole future — when it gets accepted, when it goes out for
-- delivery, whether it is going to be cancelled and why — is decided the
-- moment it is created, and written here. The ticker then just applies
-- whatever has come due, which makes each tick a single set-based UPDATE
-- instead of per-order logic, and makes the simulation reproducible: replaying
-- a window produces the same outcomes.
--
-- Lives in `sim`, not on vendor_kpi: the warehouse tables mirror what the
-- organisation's real ones look like, and a column announcing when an order is
-- *going* to be cancelled is not something a real warehouse has.
CREATE TABLE sim.order_plan (
    order_id        bigint PRIMARY KEY,
    accept_at       timestamptz NOT NULL,
    prepare_at      timestamptz NOT NULL,
    ready_at        timestamptz NOT NULL,
    dispatch_at     timestamptz NOT NULL,
    terminal_at     timestamptz NOT NULL,
    terminal_status text        NOT NULL,
    cancel_comment  text,
    cancelled_by    text,
    -- Support contact this order will generate, if any.
    contact_at      timestamptz,
    contact_kind    text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- The ticker's hot path: "what has come due since the last tick".
CREATE INDEX order_plan_due_idx ON sim.order_plan (terminal_at);
CREATE INDEX order_plan_contact_idx ON sim.order_plan (contact_at) WHERE contact_at IS NOT NULL;

-- Append-only operational log: seeds, ticks, prunes, catch-ups, gaps. The
-- health endpoint reads the tail of this to answer "is the simulator alive".
CREATE TABLE sim.run_log (
    id     bigserial PRIMARY KEY,
    at     timestamptz NOT NULL DEFAULT now(),
    event  text NOT NULL,
    detail jsonb
);

CREATE INDEX run_log_at_idx ON sim.run_log (at DESC);
