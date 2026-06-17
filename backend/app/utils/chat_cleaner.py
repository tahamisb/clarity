import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def clean_chat_messages(messages_json: str) -> Optional[str]:
    """
    Parses a JSON string of chat messages, extracts genuine customer text,
    and returns a single joined string. Returns None if the result is < 10 chars.
    """
    if not messages_json:
        return None

    try:
        messages = json.loads(messages_json)
    except Exception as e:
        logger.warning(f"Failed to parse messages JSON: {e}")
        return None

    if not isinstance(messages, list):
        return None

    genuine_messages = []
    last_bot_options = set()

    for msg in messages:
        if not isinstance(msg, dict):
            continue

        from_bot = int(msg.get("from_bot", 0))
        agent_id = msg.get("agent_id")
        text = str(msg.get("message", "")).strip()

        # Track bot options for the next customer message
        if from_bot == 1:
            reply_options_raw = msg.get("reply_options")
            options = set()
            if reply_options_raw and isinstance(reply_options_raw, str):
                try:
                    parsed_opts = json.loads(reply_options_raw)
                    if isinstance(parsed_opts, list):
                        options = {str(opt).strip().lower() for opt in parsed_opts}
                except Exception:
                    pass
            last_bot_options = options
            continue

        # Skip agent messages
        if agent_id is not None:
            last_bot_options = set() # Reset
            continue

        # Must be customer message (from_bot == 0 and agent_id is None)
        if not text:
            continue

        # Skip if it's an exact match for a menu option (button tap)
        # Or if it's a single word and exactly matches an option
        if text.lower() in last_bot_options:
            continue

        genuine_messages.append(text)
        last_bot_options = set() # Reset after processing a customer message

    cleaned_text = "\n".join(genuine_messages).strip()

    if len(cleaned_text) < 10:
        return None

    return cleaned_text
