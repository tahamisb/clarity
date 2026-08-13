-- Grants. Products are readers of the warehouse and writers of nothing in it.
--
-- The read-only grant is the point of the exercise: it makes "we are a
-- consumer of someone else's warehouse" structurally true rather than a claim,
-- and it makes an accidental write during a demo impossible.

-- Readable schemas.
GRANT USAGE ON SCHEMA warehouse, compat, public TO warehouse_readers;
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse TO warehouse_readers;
GRANT SELECT ON ALL TABLES IN SCHEMA compat    TO warehouse_readers;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO warehouse_readers;

-- Tables added later (retention partitions, new warehouse tables) inherit it.
ALTER DEFAULT PRIVILEGES IN SCHEMA warehouse GRANT SELECT ON TABLES TO warehouse_readers;
ALTER DEFAULT PRIVILEGES IN SCHEMA compat    GRANT SELECT ON TABLES TO warehouse_readers;
ALTER DEFAULT PRIVILEGES IN SCHEMA public    GRANT EXECUTE ON FUNCTIONS TO warehouse_readers;

-- Explicitly NOT granted: sim. Products have no business reading the
-- simulator's internals, and a product that cannot see them cannot come to
-- depend on them.
REVOKE ALL ON SCHEMA sim FROM PUBLIC;

-- `app` is product-owned runtime state (Clarity's waitlist). Writable.
GRANT USAGE ON SCHEMA app TO clarity_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO clarity_reader;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO clarity_reader;

-- Two exceptions to read-only, and they are worth being explicit about.
--
-- `call_analysis` and `cancellation_predictions` are not warehouse *inputs* —
-- they are things Clarity PRODUCES: a Gemini analysis of a transcript, a model
-- score for an open order. They sit in `warehouse` today only because the
-- simulator seeds them so the dashboards have history on a cold start.
--
-- When the real warehouse arrives they belong in `app` (or in Clarity's own
-- database), and Phase 5 — where the classifier and predictor run live against
-- arriving rows — is the natural moment to move them. Until then the app needs
-- INSERT, and nothing else: no UPDATE, no DELETE, and no write access to any
-- table the organisation would actually own.
GRANT INSERT ON warehouse.call_analysis TO clarity_reader;
-- classifications joins that list from Phase 5 on: the backend now labels
-- messages as they arrive rather than reading pre-baked results.
GRANT INSERT ON warehouse.classifications TO clarity_reader;
GRANT INSERT ON warehouse.cancellation_predictions TO clarity_reader;
GRANT USAGE, SELECT ON SEQUENCE warehouse.cancellation_predictions_id_seq TO clarity_reader;

-- Nobody should be creating tables in public on a shared warehouse.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Resolve unqualified table names to the compat views first, then the real
-- tables. A product migrating to native types drops `compat` from its own
-- connection's search_path — no coordination needed with anyone else.
ALTER ROLE clarity_reader SET search_path = compat, warehouse, app, public;
ALTER ROLE nabd_reader    SET search_path = compat, warehouse, public;
