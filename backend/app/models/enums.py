from enum import Enum


# Pillar 01 — calls
class CallSentimentEnum(str, Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class CallIntentEnum(str, Enum):
    order_status = "order_status"
    refund_request = "refund_request"
    complaint = "complaint"
    cancellation = "cancellation"
    escalation = "escalation"
    praise = "praise"
    delivery_issue = "delivery_issue"
    wrong_item = "wrong_item"
    payment_issue = "payment_issue"
    account_issue = "account_issue"
    general_inquiry = "general_inquiry"


# Pillar 02 — text / chat messages
class TextSentimentEnum(str, Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class TextIntentEnum(str, Enum):
    complaint = "complaint"
    refund = "refund"
    order_query = "order_query"
    cancellation_request = "cancellation_request"
    praise = "praise"
    escalation = "escalation"


class SourceChannelEnum(str, Enum):
    app = "app"
    whatsapp = "whatsapp"
    ticket = "ticket"
