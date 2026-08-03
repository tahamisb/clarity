import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.routers import waitlist
from app.routers.waitlist import EMAIL_RE
from app.services.local_db import query

client = TestClient(app)


class _FakeSMTP:
    """Stands in for smtplib.SMTP — records what would have been sent."""

    sent: list = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self):
        pass

    def login(self, user, password):
        pass

    def send_message(self, msg):
        _FakeSMTP.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    """Configure SMTP and capture outgoing mail instead of sending it."""
    settings = get_settings()
    for field, value in [
        ("smtp_host", "smtp.test"),
        ("smtp_user", "bot@gorafeeq.com"),
        ("smtp_password", "app-password"),
        ("smtp_port", 587),
    ]:
        monkeypatch.setattr(settings, field, value)
    monkeypatch.setattr(waitlist.smtplib, "SMTP", _FakeSMTP)
    _FakeSMTP.sent = []
    return _FakeSMTP


def test_email_regex_rejects_junk():
    for bad in ["", "nope", "a@b", "a b@c.com", "@c.com", "a@.com"]:
        assert not EMAIL_RE.match(bad), bad
    for good in ["a@b.co", "t.mutahir+clarity@example.com"]:
        assert EMAIL_RE.match(good), good


def test_signup_is_stored_and_normalised():
    res = client.post(
        "/api/v1/waitlist",
        json={"email": "  Sales.Lead@Example.COM ", "company": "Acme", "plan": "growth"},
    )
    assert res.status_code == 201

    rows = query(
        "SELECT email, company, plan FROM waitlist WHERE email = ?",
        ("sales.lead@example.com",),
    )
    assert rows and rows[-1]["company"] == "Acme" and rows[-1]["plan"] == "growth"


def test_invalid_email_is_rejected():
    assert client.post("/api/v1/waitlist", json={"email": "not-an-email"}).status_code == 422


def test_signup_is_emailed_to_sales(smtp):
    res = client.post(
        "/api/v1/waitlist",
        json={"email": "lead@example.com", "company": "Acme", "plan": "growth"},
    )
    assert res.status_code == 201

    assert len(smtp.sent) == 1
    msg = smtp.sent[0]
    assert msg["To"] == "t.mutahir@gorafeeq.com"
    assert msg["Reply-To"] == "lead@example.com"
    assert "lead@example.com" in msg["Subject"]
    assert "Acme" in msg.get_content() and "growth" in msg.get_content()


def test_signup_survives_a_broken_smtp_server(smtp, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(waitlist.smtplib, "SMTP", boom)

    res = client.post("/api/v1/waitlist", json={"email": "resilient@example.com"})
    assert res.status_code == 201
    assert query(
        "SELECT email FROM waitlist WHERE email = ?", ("resilient@example.com",)
    )
