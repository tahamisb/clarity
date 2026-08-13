import re
import unicodedata
from datetime import datetime, timezone

from app.utils import clock


_PHONE_RE = re.compile(r"\+?[\d\s\-\(\)]{7,}")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_MULTI_SPACE = re.compile(r"\s{2,}")


def redact_pii(text: str) -> str:
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = _PHONE_RE.sub("[REDACTED_PHONE]", text)
    return text


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = _MULTI_SPACE.sub(" ", text)
    return text.strip()


def preprocess(text: str) -> str:
    return redact_pii(clean_text(text))


# "Now" comes from the app clock — real time, or pinned when reading the
# frozen snapshot. See app/utils/clock.py.
def utcnow_iso() -> str:
    return clock.now_iso()


def parse_datetime_or_now(value: "str | datetime | None") -> datetime:
    if value is None:
        return clock.now()
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return clock.now()


def strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        start = 1 if lines[0].startswith("```") else 0
        end = len(lines) - 1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[start:end]).strip()
    return text


def _balanced_json_block(text: str) -> str | None:
    """Return the first balanced {...} block (ignores braces inside strings)."""
    start = text.find("{")
    if start == -1:
        return None
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
    return None


def extract_json(text: str) -> dict:
    """
    Tolerant JSON parse for LLM output. Strips fences, isolates the first
    balanced object, and removes trailing commas before retrying. Raises
    json.JSONDecodeError if nothing parseable is found.
    """
    import json
    import re

    cleaned = strip_markdown_fences(text)
    candidates = []
    block = _balanced_json_block(cleaned)
    if block:
        candidates.append(block)
    candidates.append(cleaned)

    for cand in candidates:
        for attempt in (cand, re.sub(r",(\s*[}\]])", r"\1", cand)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue
    raise json.JSONDecodeError("No parseable JSON object found", text, 0)

# Closers that are not human agents — these mean the chat was handled entirely by
# the bot or closed by the customer/system (i.e. no bot→agent handover).
_NON_AGENT_CLOSERS = {"cron", "customer", "bot", "system", "agent"}


def derive_agent_name(closed_by: str | None) -> str | None:
    """The human agent who handled/closed a chat, or None when bot/customer-closed.

    chat_history.closed_by holds the closer's name for agent-handled chats
    (e.g. "Fatima Ezzahra") and a system keyword otherwise. A non-null result
    marks a bot→agent handover.
    """
    if not closed_by:
        return None
    name = str(closed_by).strip()
    if not name or name.lower() in _NON_AGENT_CLOSERS:
        return None
    return name


def derive_channel(type_field: str | None, device_id: str | None) -> str:
    type_field = (type_field or "").lower()
    if "whatsapp" in type_field:
        return "whatsapp"
    if "app" in type_field or device_id:
        return "app"
    return "ticket"
