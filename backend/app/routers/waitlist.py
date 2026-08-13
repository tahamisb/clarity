"""
Waitlist signups from the frontend's "Unlock full version" modal.

No pricing, no checkout — the modal only captures an email so sales can follow
up. Every signup is stored in the local warehouse *and* emailed to
`WAITLIST_NOTIFY_TO` (default t.mutahir@gorafeeq.com) over plain SMTP.

Read the stored rows with:

    sqlite3 backend/data/clarity.db "SELECT * FROM waitlist ORDER BY created_at DESC"

SMTP settings live in .env (SMTP_HOST/PORT/USER/PASSWORD). Unset = signups are
stored and logged, just not emailed.
"""

import logging
import re
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.services.warehouse import ensure_waitlist_table, insert_rows, query

router = APIRouter(prefix="/api/v1", tags=["waitlist"])
logger = logging.getLogger(__name__)

# ponytail: regex instead of pydantic EmailStr — that pulls in email-validator
# for a field a human reads anyway. Swap if we ever gate on deliverability.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# The waitlist is the only table written at runtime, so it has to exist before
# the first signup. Where it lives and how it is created is the warehouse
# driver's business — on Postgres it ships with the schema and this is a no-op.
ensure_waitlist_table()


class WaitlistSignup(BaseModel):
    email: str
    company: str | None = None
    note: str | None = None
    plan: str | None = None


def _clean(value: str | None, limit: int) -> str | None:
    """Trim and cap a free-text field; empty becomes NULL."""
    if not value:
        return None
    return value.strip()[:limit] or None


@router.get("/waitlist/status")
def waitlist_status():
    """Is this deployment able to email signups? Secrets are never returned —
    only whether they are set. Exists because a signup returns 201 either way,
    so an unconfigured deploy silently swallows notifications."""
    s = get_settings()
    return {
        "smtp_configured": bool(s.smtp_host and s.smtp_user and s.smtp_password),
        "smtp_host": s.smtp_host or None,
        "smtp_port": s.smtp_port,
        "smtp_user_set": bool(s.smtp_user),
        "smtp_password_set": bool(s.smtp_password),
        "notify_to": s.waitlist_notify_to,
        "signups": (query("SELECT COUNT(*) AS n FROM waitlist") or [{"n": 0}])[0]["n"],
        "last_send_error": _last_send_error,
    }


# Why the last send failed, surfaced by /waitlist/status. ponytail: a single
# in-process string, not a delivery log — enough to debug a deploy you can't shell into.
_last_send_error: str | None = None


def notify_sales(row: dict) -> None:
    """Email a signup to the sales inbox. Runs as a background task — SMTP is
    slow and must never fail the signup, which is already stored by then."""
    global _last_send_error
    s = get_settings()
    if not (s.smtp_host and s.smtp_user and s.smtp_password):
        logger.warning(
            "waitlist: SMTP not configured — %s stored but not emailed", row["email"]
        )
        return

    msg = EmailMessage()
    msg["Subject"] = f"New Clarity waitlist signup — {row['email']}"
    msg["From"] = s.smtp_from or s.smtp_user
    msg["To"] = s.waitlist_notify_to
    msg["Reply-To"] = row["email"]  # hitting reply answers the lead directly
    msg.set_content(
        "\n".join(
            [
                f"Email:    {row['email']}",
                f"Company:  {row['company'] or '—'}",
                f"Plan:     {row['plan'] or '—'}",
                f"Note:     {row['note'] or '—'}",
                f"Received: {row['created_at']} UTC",
            ]
        )
    )

    try:
        connect = smtplib.SMTP_SSL if s.smtp_port == 465 else smtplib.SMTP
        with connect(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_port != 465:
                smtp.starttls()
            # Google displays app passwords as "xxxx xxxx xxxx xxxx"; the
            # spaces are decoration and some servers reject them.
            smtp.login(s.smtp_user, s.smtp_password.replace(" ", ""))
            smtp.send_message(msg)
        _last_send_error = None
        logger.info("waitlist: emailed %s to %s", row["email"], s.waitlist_notify_to)
    except Exception as exc:  # noqa: BLE001
        # The row is in the warehouse regardless — a bounced notification is a
        # delivery problem, not lost data.
        _last_send_error = f"{type(exc).__name__}: {exc}"[:300]
        logger.error("waitlist: email notify failed for %s — %s", row["email"], exc)


@router.post("/waitlist", status_code=201)
def join_waitlist(signup: WaitlistSignup, background: BackgroundTasks):
    """Record a waitlist signup and email it to sales. Duplicates are kept — a
    second signup is a signal, not an error."""
    email = signup.email.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    row = {
        "email": email,
        "company": _clean(signup.company, 120),
        "note": _clean(signup.note, 1000),
        "plan": _clean(signup.plan, 40),
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }
    insert_rows("waitlist", [row])
    logger.info("waitlist signup: %s (plan=%s)", email, signup.plan)

    background.add_task(notify_sales, row)
    return {"status": "joined"}
