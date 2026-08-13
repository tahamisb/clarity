"""
Scenario control — a small HTTP API for bending the simulation mid-demo.

This is the part of the project a customer remembers. Triggering a merchant
outage in West Bay and watching the negative-trend card, the zone heatmap and
the cancellation risk queue all light up on their own, ninety seconds later,
without anyone touching the app, is the difference between showing a dashboard
and demonstrating one.

It lives with the *simulator*, not with Clarity, and that placement is the
whole point: Clarity has no idea scenarios exist. It cannot — a product that
knows when the interesting data is coming is not being demonstrated, it is
being staged. Clarity only ever sees orders and complaints arriving from a
warehouse, exactly as it would in production.

Bound to the internal network only; there is no authentication because there is
nothing to authenticate against and nothing here reaches the public internet.
Do not publish this port.

    POST /scenarios  {"kind": "merchant_outage", "target": "Turkey Central",
                      "duration_min": 45, "magnitude": 3.0}
    GET  /scenarios            active + recent
    DELETE /scenarios/{id}     end one early
    DELETE /scenarios          end all — the "reset the demo" button
    GET  /status               cursor, volumes, last tick
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger(__name__)
UTC = timezone.utc

KINDS = ("merchant_outage", "zone_courier_shortage", "sentiment_storm", "volume_spike")

# What each scenario needs, and what it does — surfaced by GET /scenarios so
# whoever is driving the demo does not need this file open.
KIND_HELP = {
    "merchant_outage": "target = merchant name. Accept times blow out and cancellations "
                       "spike for that merchant; reason skews to 'Items out of stock at vendor'.",
    "zone_courier_shortage": "target = zone name. Delivery times stretch and "
                             "'No driver available' cancellations surge in that zone.",
    "sentiment_storm": "target = channel or omitted. Negative-sentiment share jumps "
                       "on incoming support contacts.",
    "volume_spike": "target unused. Multiplies the order arrival rate — match day, weather.",
}


def _json(handler: BaseHTTPRequestHandler, status: int, payload: object) -> None:
    body = json.dumps(payload, indent=2, default=str).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def make_handler(dsn: str):
    class Handler(BaseHTTPRequestHandler):
        # Quiet by default: one line per request at info level rather than the
        # stdlib's stderr spew.
        def log_message(self, fmt, *args):
            logger.debug("control %s", fmt % args)

        def _conn(self):
            return psycopg.connect(dsn, row_factory=dict_row)

        # -- GET ---------------------------------------------------------
        def do_GET(self):  # noqa: N802 — stdlib naming
            path = urlparse(self.path).path.rstrip("/") or "/"
            try:
                if path in ("/", "/scenarios"):
                    with self._conn() as conn:
                        active = conn.execute(
                            "SELECT * FROM sim.active_scenarios ORDER BY starts_at"
                        ).fetchall()
                        recent = conn.execute(
                            "SELECT * FROM sim.scenarios ORDER BY created_at DESC LIMIT 10"
                        ).fetchall()
                    return _json(self, 200, {"active": active, "recent": recent, "kinds": KIND_HELP})

                if path == "/status":
                    with self._conn() as conn:
                        cursor = conn.execute("SELECT * FROM sim.tick_cursor").fetchone()
                        counts = conn.execute("""
                            SELECT
                              (SELECT count(*) FROM warehouse.vendor_kpi)              AS orders,
                              (SELECT count(*) FROM warehouse.vendor_kpi
                                WHERE placed_at > now() - interval '1 hour')           AS orders_last_hour,
                              (SELECT count(*) FROM warehouse.vendor_kpi
                                WHERE order_status IN ('Accepted','Preparing',
                                                       'Ready for pickup','Out for delivery')
                              )                                                        AS in_flight,
                              (SELECT count(*) FROM warehouse.messages)                AS messages,
                              (SELECT count(*) FROM sim.order_plan)                    AS open_plans
                        """).fetchone()
                        log = conn.execute(
                            "SELECT at, event, detail FROM sim.run_log ORDER BY at DESC LIMIT 5"
                        ).fetchall()
                    lag = None
                    if cursor and cursor["last_tick_at"]:
                        lag = (datetime.now(UTC) - cursor["last_tick_at"]).total_seconds()
                    return _json(self, 200, {
                        "cursor": cursor, "tick_lag_seconds": lag, "counts": counts, "recent": log,
                    })

                return _json(self, 404, {"error": f"no route {path}"})
            except Exception as exc:  # noqa: BLE001
                logger.exception("control GET failed")
                return _json(self, 500, {"error": str(exc)})

        # -- POST --------------------------------------------------------
        def do_POST(self):  # noqa: N802
            path = urlparse(self.path).path.rstrip("/")
            if path != "/scenarios":
                return _json(self, 404, {"error": f"no route {path}"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")

                kind = str(body.get("kind", "")).strip()
                if kind not in KINDS:
                    return _json(self, 400, {
                        "error": f"kind must be one of {list(KINDS)}", "kinds": KIND_HELP,
                    })

                target = body.get("target")
                if kind in ("merchant_outage", "zone_courier_shortage") and not target:
                    # Without a target these would apply platform-wide, which is
                    # not what "one merchant is down" means and would look like
                    # a total outage rather than an emerging issue.
                    return _json(self, 400, {"error": f"{kind} requires a target"})

                duration = float(body.get("duration_min", 30))
                magnitude = float(body.get("magnitude", 2.0))
                starts = datetime.now(UTC)

                with self._conn() as conn:
                    row = conn.execute(
                        """
                        INSERT INTO sim.scenarios (kind, target, magnitude, starts_at, ends_at, note)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING *
                        """,
                        (kind, target, magnitude, starts,
                         starts + timedelta(minutes=duration), body.get("note")),
                    ).fetchone()
                    conn.commit()
                logger.info("scenario started: %s target=%s for %.0fmin", kind, target, duration)
                return _json(self, 201, row)
            except Exception as exc:  # noqa: BLE001
                logger.exception("control POST failed")
                return _json(self, 500, {"error": str(exc)})

        # -- DELETE ------------------------------------------------------
        def do_DELETE(self):  # noqa: N802
            path = urlparse(self.path).path.rstrip("/")
            try:
                with self._conn() as conn:
                    if path == "/scenarios":
                        # End, don't delete: the run log should still show that
                        # a scenario ran when someone asks why the charts moved.
                        n = conn.execute(
                            "UPDATE sim.scenarios SET ends_at = now() WHERE ends_at > now()"
                        ).rowcount
                        conn.commit()
                        return _json(self, 200, {"ended": n})
                    if path.startswith("/scenarios/"):
                        sid = path.rsplit("/", 1)[-1]
                        if not sid.isdigit():
                            return _json(self, 400, {"error": "id must be numeric"})
                        n = conn.execute(
                            "UPDATE sim.scenarios SET ends_at = now() WHERE id = %s AND ends_at > now()",
                            (int(sid),),
                        ).rowcount
                        conn.commit()
                        return _json(self, 200 if n else 404, {"ended": n})
                return _json(self, 404, {"error": f"no route {path}"})
            except Exception as exc:  # noqa: BLE001
                logger.exception("control DELETE failed")
                return _json(self, 500, {"error": str(exc)})

    return Handler


def serve(dsn: str, host: str = "0.0.0.0", port: int = 8080) -> None:
    server = HTTPServer((host, port), make_handler(dsn))
    logger.info("scenario control listening on %s:%d", host, port)
    server.serve_forever()
