-- BigQuery-builtin shims, round two.
--
-- backend/app/services/local_db.py registers six Python UDFs on every SQLite
-- connection so the BigQuery SQL text could survive the port to SQLite. Define
-- them here under the SAME names and the same SQL keeps working on Postgres —
-- no query rewriting, which is most of what makes the backend port small.
--
-- Overloads take `text` first because that is what the compat views expose
-- (legacy TEXT timestamps); date/timestamptz overloads are for native readers.
--
-- Parity note: SQLite's mode_value breaks ties by first-seen; this one breaks
-- ties by value. Group-bys with a tied top value can differ between backends.
-- That is the one known divergence — see warehouse/README.md.

SET search_path = warehouse, public;

-- REGEXP_CONTAINS(s, pattern) -----------------------------------------------
-- Returned 1/0 under SQLite (no boolean type); boolean here. Both work in the
-- `CASE WHEN regexp_contains(...) THEN` shape every caller uses.
CREATE FUNCTION public.regexp_contains(value text, pattern text)
RETURNS boolean AS $$
    SELECT CASE WHEN value IS NULL OR pattern IS NULL THEN false ELSE value ~ pattern END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- FORMAT_DATE('%G-W%V', d) → '2026-W31' -------------------------------------
CREATE FUNCTION public.iso_week(d date)
RETURNS text AS $$ SELECT to_char(d, 'IYYY-"W"IW') $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.iso_week(ts text)
RETURNS text AS $$ SELECT public.iso_week(substr(ts, 1, 10)::date) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.iso_week(ts timestamptz)
RETURNS text AS $$ SELECT public.iso_week((ts AT TIME ZONE 'UTC')::date) $$
LANGUAGE sql STABLE PARALLEL SAFE;

-- DATE_TRUNC(ts, WEEK(MONDAY)) → 'YYYY-MM-DD' -------------------------------
-- Returns text, matching the SQLite UDF: callers GROUP BY and ORDER BY the
-- result and hand it straight to the frontend as a string.
CREATE FUNCTION public.week_start(d date)
RETURNS text AS $$ SELECT to_char(date_trunc('week', d), 'YYYY-MM-DD') $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.week_start(ts text)
RETURNS text AS $$ SELECT public.week_start(substr(ts, 1, 10)::date) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.week_start(ts timestamptz)
RETURNS text AS $$ SELECT public.week_start((ts AT TIME ZONE 'UTC')::date) $$
LANGUAGE sql STABLE PARALLEL SAFE;

-- FORMAT_DATE('%A', d) → 'Monday' -------------------------------------------
CREATE FUNCTION public.day_name(d date)
RETURNS text AS $$ SELECT to_char(d, 'FMDay') $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.day_name(ts text)
RETURNS text AS $$ SELECT public.day_name(substr(ts, 1, 10)::date) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.day_name(ts timestamptz)
RETURNS text AS $$ SELECT public.day_name((ts AT TIME ZONE 'UTC')::date) $$
LANGUAGE sql STABLE PARALLEL SAFE;

-- SPLIT(s, sep)[OFFSET(0)] --------------------------------------------------
CREATE FUNCTION public.split_first(value text, sep text)
RETURNS text AS $$ SELECT CASE WHEN value IS NULL THEN NULL ELSE split_part(value, sep, 1) END $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- strftime(format, value) ---------------------------------------------------
-- Not a BigQuery builtin — a SQLite one that survived the first port and is
-- still in the query text. Only three formats are actually used
-- (`%H` in hour_of, `%w` and `%Y-%m` in cancellation_service), so shimming it
-- is cheaper than rewriting those call sites, and anything unrecognised raises
-- rather than quietly returning something plausible.
--
-- Argument order matches SQLite: format first. Returns text, as SQLite does,
-- so `CAST(strftime('%w', d) AS INTEGER)` keeps working.
CREATE FUNCTION public.raise_unsupported_strftime(fmt text)
RETURNS boolean AS $$
BEGIN
    RAISE EXCEPTION 'strftime shim does not implement format %', fmt
        USING HINT = 'Add it to warehouse/sql/020_functions.sql';
END
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION public.strftime(fmt text, value text)
RETURNS text AS $$
    SELECT CASE fmt
        WHEN '%H'       THEN to_char(value::timestamp, 'HH24')
        WHEN '%w'       THEN extract(dow FROM value::timestamp)::int::text  -- 0 = Sunday, as SQLite
        WHEN '%Y-%m'    THEN to_char(value::timestamp, 'YYYY-MM')
        WHEN '%Y-%m-%d' THEN to_char(value::timestamp, 'YYYY-MM-DD')
        WHEN '%Y'       THEN to_char(value::timestamp, 'YYYY')
        WHEN '%m'       THEN to_char(value::timestamp, 'MM')
        WHEN '%A'       THEN to_char(value::timestamp, 'FMDay')
        ELSE (SELECT NULL::text WHERE public.raise_unsupported_strftime(fmt))
    END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- date(x) --------------------------------------------------------------------
-- Deliberately NOT shimmed. `date` is a Postgres type name, so `date(expr)` is
-- parsed as cast syntax whenever the argument is an untyped literal, but binds
-- to a user function when the argument is a known text column. Defining
-- `date(text)` therefore makes `date(col) >= date('2026-01-01')` compare text
-- against date and fail — the shim causes the very bug it looks like it fixes.
--
-- Postgres's own text→date cast already does the right thing at every call
-- site, and the driver renders the resulting date back to 'YYYY-MM-DD', which
-- is what SQLite returned. Compare bare ISO columns as strings instead of
-- wrapping them (see cancellation_service._date_pred).

-- datetime(x) ----------------------------------------------------------------
-- Shimmed, unlike date(): `datetime` is not a Postgres type name, so there is
-- no cast syntax to collide with. Returns text, as SQLite's does.
CREATE FUNCTION public.datetime(value text)
RETURNS text AS $$ SELECT to_char(value::timestamp, 'YYYY-MM-DD HH24:MI:SS') $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- group_concat(x) / group_concat(DISTINCT x) --------------------------------
-- SQLite's string_agg. A one-argument aggregate so `DISTINCT` still parses,
-- and comma-joined with no spaces so `split_agg()` on the Python side keeps
-- working unchanged.
CREATE FUNCTION public.array_to_comma(arr text[])
RETURNS text AS $$ SELECT nullif(array_to_string(arr, ','), '') $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE AGGREGATE public.group_concat(text) (
    SFUNC     = array_append,
    STYPE     = text[],
    FINALFUNC = public.array_to_comma,
    INITCOND  = '{}',
    PARALLEL  = SAFE
);

-- ROUND(x, places) on a float ------------------------------------------------
-- Postgres ships round(numeric, int) and round(double precision) but NOT
-- round(double precision, int) — and the dashboards round float rates
-- everywhere (`ROUND(rate * 100, 1)`). Without this every percentage query
-- fails with "function round(double precision, integer) does not exist".
CREATE FUNCTION public.round(value double precision, places integer)
RETURNS double precision AS $$ SELECT round(value::numeric, places)::double precision $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- json_extract(doc, path) ----------------------------------------------------
-- SQLite's JSON1 function, used to pull the first entity out of the
-- JSON-encoded arrays on call_analysis (`'$[0]'`). Implements the subset of
-- the path syntax that appears in the queries and raises on anything else,
-- rather than silently returning NULL for a path it does not understand.
--
-- Unparseable JSON returns NULL, matching SQLite — one malformed row should
-- not take down a dashboard.
CREATE FUNCTION public.json_extract(doc text, path text)
RETURNS text AS $$
DECLARE parsed jsonb;
BEGIN
    IF doc IS NULL OR path IS NULL THEN RETURN NULL; END IF;
    BEGIN
        parsed := doc::jsonb;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    IF path ~ '^\$\[[0-9]+\]$' THEN
        RETURN parsed ->> (substring(path from '[0-9]+'))::int;
    ELSIF path ~ '^\$\.[A-Za-z_][A-Za-z0-9_]*$' THEN
        RETURN parsed ->> substring(path from 3);
    ELSIF path = '$' THEN
        RETURN parsed #>> '{}';
    END IF;
    RAISE EXCEPTION 'json_extract shim does not implement path %', path
        USING HINT = 'Add it to warehouse/sql/020_functions.sql';
END
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overloads for the native types the compat views expose. Before those views
-- stopped rendering everything to text, a `date` or `timestamptz` argument here
-- had no candidate function at all.
--
-- Each formats the value DIRECTLY. The obvious shortcut — delegate to the text
-- version with `value::text` — costs two conversions and a re-parse per row,
-- and on 1.4M orders `strftime('%Y-%m', order_placement_date)` took 31.9 s
-- against 94 ms for a bare to_char. The monthly cancellation trend was the
-- slowest endpoint in the product because of it.
CREATE FUNCTION public.strftime(fmt text, value date)
RETURNS text AS $$
    SELECT CASE fmt
        WHEN '%Y-%m'    THEN to_char(value, 'YYYY-MM')
        WHEN '%w'       THEN extract(dow FROM value)::int::text
        WHEN '%Y-%m-%d' THEN to_char(value, 'YYYY-MM-DD')
        WHEN '%Y'       THEN to_char(value, 'YYYY')
        WHEN '%m'       THEN to_char(value, 'MM')
        WHEN '%A'       THEN to_char(value, 'FMDay')
        WHEN '%H'       THEN '00'   -- a date has no time of day
        ELSE (SELECT NULL::text WHERE public.raise_unsupported_strftime(fmt))
    END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.strftime(fmt text, value timestamptz)
RETURNS text AS $$
    SELECT CASE fmt
        WHEN '%H'       THEN to_char(value AT TIME ZONE 'UTC', 'HH24')
        WHEN '%w'       THEN extract(dow FROM value AT TIME ZONE 'UTC')::int::text
        WHEN '%Y-%m'    THEN to_char(value AT TIME ZONE 'UTC', 'YYYY-MM')
        WHEN '%Y-%m-%d' THEN to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        WHEN '%Y'       THEN to_char(value AT TIME ZONE 'UTC', 'YYYY')
        WHEN '%m'       THEN to_char(value AT TIME ZONE 'UTC', 'MM')
        WHEN '%A'       THEN to_char(value AT TIME ZONE 'UTC', 'FMDay')
        ELSE (SELECT NULL::text WHERE public.raise_unsupported_strftime(fmt))
    END
$$ LANGUAGE sql STABLE PARALLEL SAFE;

CREATE FUNCTION public.datetime(value timestamptz)
RETURNS text AS $$ SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$
LANGUAGE sql STABLE PARALLEL SAFE;

-- json_each(doc) --------------------------------------------------------------
-- SQLite's table-valued JSON1 function, used to explode the JSON arrays on
-- call_analysis in a FROM clause (`FROM call_analysis ca, json_each(ca.areas)`).
-- Postgres applies LATERAL implicitly to set-returning functions in FROM, so
-- the reference to `ca` resolves the same way it does under SQLite.
--
-- Only the columns the queries actually read are provided (key, value, type);
-- SQLite's version also exposes atom/id/parent/fullkey/path. Arrays only —
-- which is all these columns ever hold.
--
-- NULL or unparseable input yields no rows rather than raising: on a dataset
-- this size, one malformed row should not empty an entire dashboard panel.
CREATE FUNCTION public.json_each(doc text)
RETURNS TABLE (key integer, value text, type text) AS $$
DECLARE parsed jsonb;
BEGIN
    IF doc IS NULL THEN RETURN; END IF;
    BEGIN
        parsed := doc::jsonb;
    EXCEPTION WHEN others THEN
        RETURN;
    END;
    IF jsonb_typeof(parsed) <> 'array' THEN RETURN; END IF;
    RETURN QUERY
        SELECT (ord - 1)::integer, el #>> '{}', jsonb_typeof(el)
        FROM jsonb_array_elements(parsed) WITH ORDINALITY AS t(el, ord);
END
$$ LANGUAGE plpgsql IMMUTABLE;

-- APPROX_TOP_COUNT(x, 1)[OFFSET(0)].value -----------------------------------
-- Postgres has mode() WITHIN GROUP, but that is ordered-set syntax and would
-- mean rewriting every call site. A plain aggregate keeps the SQL identical.
--
-- The state is a COUNTER, not the list of values seen. The obvious
-- implementation — array_append into an anyarray, then unnest and count in the
-- final function — is O(rows) memory per group and collapsed on real volume:
-- one GROUP BY over 1.4M orders went from 187 ms without it to over 25 s with
-- it, and every dashboard on the box timed out. Counting into a jsonb object
-- is O(distinct values) instead, and the same query runs in 2.4 s.
--
-- Ties break by key, so the result is deterministic. SQLite's UDF breaks them
-- by first-seen, which is the one known cross-engine divergence.
CREATE FUNCTION public._mode_accum(state jsonb, value text)
RETURNS jsonb AS $$
    SELECT CASE WHEN value IS NULL THEN state
           ELSE jsonb_set(state, ARRAY[value],
                          to_jsonb(COALESCE((state ->> value)::bigint, 0) + 1)) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public._mode_final(state jsonb)
RETURNS text AS $$
    SELECT key FROM jsonb_each_text(state) ORDER BY value::bigint DESC, key LIMIT 1
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE AGGREGATE public.mode_value(text) (
    SFUNC     = public._mode_accum,
    STYPE     = jsonb,
    FINALFUNC = public._mode_final,
    INITCOND  = '{}',
    PARALLEL  = SAFE
);

-- ROUND(x, places) on a float ------------------------------------------------
-- Postgres ships round(numeric, int) and round(double precision) but NOT
-- round(double precision, int) — and the dashboards round float rates
-- everywhere (`ROUND(rate * 100, 1)`). Without this every percentage query
-- fails with "function round(double precision, integer) does not exist".
CREATE FUNCTION public.round(value double precision, places integer)
RETURNS double precision AS $$ SELECT round(value::numeric, places)::double precision $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- json_extract(doc, path) ----------------------------------------------------
-- SQLite's JSON1 function, used to pull the first entity out of the
-- JSON-encoded arrays on call_analysis (`'$[0]'`). Implements the subset of
-- the path syntax that appears in the queries and raises on anything else,
-- rather than silently returning NULL for a path it does not understand.
--
-- Unparseable JSON returns NULL, matching SQLite — one malformed row should
-- not take down a dashboard.
CREATE FUNCTION public.json_extract(doc text, path text)
RETURNS text AS $$
DECLARE parsed jsonb;
BEGIN
    IF doc IS NULL OR path IS NULL THEN RETURN NULL; END IF;
    BEGIN
        parsed := doc::jsonb;
    EXCEPTION WHEN others THEN
        RETURN NULL;
    END;
    IF path ~ '^\$\[[0-9]+\]$' THEN
        RETURN parsed ->> (substring(path from '[0-9]+'))::int;
    ELSIF path ~ '^\$\.[A-Za-z_][A-Za-z0-9_]*$' THEN
        RETURN parsed ->> substring(path from 3);
    ELSIF path = '$' THEN
        RETURN parsed #>> '{}';
    END IF;
    RAISE EXCEPTION 'json_extract shim does not implement path %', path
        USING HINT = 'Add it to warehouse/sql/020_functions.sql';
END
$$ LANGUAGE plpgsql IMMUTABLE;

-- Overloads for the native types the compat views now expose. Before those
-- views stopped rendering everything to text, a `date` or `timestamptz`
-- argument here simply had no candidate function and the query failed.
CREATE FUNCTION public.strftime(fmt text, value date)
RETURNS text AS $$ SELECT public.strftime(fmt, value::timestamp::text) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public.strftime(fmt text, value timestamptz)
RETURNS text AS $$ SELECT public.strftime(fmt, to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')) $$
LANGUAGE sql STABLE PARALLEL SAFE;

CREATE FUNCTION public.datetime(value timestamptz)
RETURNS text AS $$ SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$
LANGUAGE sql STABLE PARALLEL SAFE;

-- json_each(doc) --------------------------------------------------------------
-- SQLite's table-valued JSON1 function, used to explode the JSON arrays on
-- call_analysis in a FROM clause (`FROM call_analysis ca, json_each(ca.areas)`).
-- Postgres applies LATERAL implicitly to set-returning functions in FROM, so
-- the reference to `ca` resolves the same way it does under SQLite.
--
-- Only the columns the queries actually read are provided (key, value, type);
-- SQLite's version also exposes atom/id/parent/fullkey/path. Arrays only —
-- which is all these columns ever hold.
--
-- NULL or unparseable input yields no rows rather than raising: on a dataset
-- this size, one malformed row should not empty an entire dashboard panel.
CREATE FUNCTION public.json_each(doc text)
RETURNS TABLE (key integer, value text, type text) AS $$
DECLARE parsed jsonb;
BEGIN
    IF doc IS NULL THEN RETURN; END IF;
    BEGIN
        parsed := doc::jsonb;
    EXCEPTION WHEN others THEN
        RETURN;
    END;
    IF jsonb_typeof(parsed) <> 'array' THEN RETURN; END IF;
    RETURN QUERY
        SELECT (ord - 1)::integer, el #>> '{}', jsonb_typeof(el)
        FROM jsonb_array_elements(parsed) WITH ORDINALITY AS t(el, ord);
END
$$ LANGUAGE plpgsql IMMUTABLE;

-- APPROX_TOP_COUNT(x, 1)[OFFSET(0)].value -----------------------------------
-- Postgres has mode() WITHIN GROUP, but that is ordered-set syntax and would
-- mean rewriting every call site. A plain aggregate keeps the SQL identical.
CREATE FUNCTION public._mode_accum(state anyarray, value anyelement)
RETURNS anyarray AS $$
    SELECT CASE WHEN value IS NULL THEN state ELSE array_append(state, value) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE FUNCTION public._mode_final(state anyarray)
RETURNS anyelement AS $$
    SELECT v FROM unnest(state) AS v GROUP BY v ORDER BY count(*) DESC, v LIMIT 1
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE AGGREGATE public.mode_value(anyelement) (
    SFUNC     = public._mode_accum,
    STYPE     = anyarray,
    FINALFUNC = public._mode_final,
    INITCOND  = '{}',
    PARALLEL  = SAFE
);
