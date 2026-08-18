"""derive_reason must never hand the UI a generic label."""

from app.services.call_service import derive_reason


def test_prefers_the_models_reason():
    assert derive_reason("Charged twice for one order", "Something else.", "payment_issue") == (
        "Charged twice for one order"
    )


def test_falls_back_to_the_summarys_leading_clause():
    got = derive_reason("", "Duplicate charge reported; agent processed the refund.", "payment_issue")
    assert got == "Duplicate charge reported"


def test_strips_generic_lead_ins():
    assert derive_reason("", "Customer called to thank the team for a fast delivery.", "praise") == (
        "Thank the team for a fast delivery"
    )
    assert derive_reason("", "General coverage enquiry for Al Khor.", "general_inquiry") == (
        "Coverage enquiry for Al Khor"
    )


def test_rejects_a_generic_reason_and_falls_through():
    assert derive_reason("General inquiry", "Missing item in a delivered order.", "wrong_item") == (
        "Missing item in a delivered order"
    )


def test_last_resort_is_the_intent_never_general_text():
    assert derive_reason("", "", "delivery_issue") == "Delivery Issue"
    assert derive_reason("N/A", "Unknown", "refund_request") == "Refund Request"
