-- Three schemas, three jobs.
--
--   warehouse  the org-shaped tables every product reads. Named after the
--              organisation's real BigQuery tables so the application SQL is
--              already written against the right vocabulary.
--   compat     views that re-render `warehouse` in the exact shapes the apps
--              read today (TEXT timestamps, 0/1 flags, JSON-as-string). The
--              seam that lets Clarity switch backends without touching a query.
--   sim        simulator control state. Never read by a product.
--   app        per-product runtime writes that are NOT warehouse data
--              (Clarity's waitlist). Products need write access here.

CREATE SCHEMA warehouse;
CREATE SCHEMA compat;
CREATE SCHEMA sim;
CREATE SCHEMA app;

COMMENT ON SCHEMA warehouse IS
    'Simulated organisation warehouse. Mirrors the real BigQuery table names. Written by the simulator only.';
COMMENT ON SCHEMA compat IS
    'Backwards-compatible views rendering warehouse tables in the legacy SQLite shapes. Temporary — drop once every product reads native types.';
COMMENT ON SCHEMA sim IS
    'Simulator control state: tick cursor, scenarios, run log.';
COMMENT ON SCHEMA app IS
    'Product-owned runtime tables that are not warehouse data.';
