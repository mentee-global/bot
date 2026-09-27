from datetime import UTC, datetime
from uuid import UUID

from app.budget.db_models import BudgetConfig, MessageUsage
from app.documents.db_models import DocumentRecord
from app.reports.db_models import BugReport


def test_record_defaults_are_available_before_flush() -> None:
    now = datetime.now(UTC)
    budget = BudgetConfig(updated_at=now)
    document = DocumentRecord(created_at=now, updated_at=now)
    report = BugReport(created_at=now, updated_at=now)
    usage = MessageUsage(created_at=now)

    assert budget.id == 1
    assert budget.default_monthly_credits == 100
    assert budget.pricing_openai_input_per_mtok_micros == 2_500_000
    assert isinstance(document.id, UUID)
    assert document.status == "pending"
    assert document.attempts == 0
    assert report.id != document.id
    assert report.status == "new"
    assert report.email_sent is False
    assert usage.source == "chat"
    assert usage.request_count == 1


def test_explicit_record_values_override_defaults() -> None:
    now = datetime.now(UTC)
    budget = BudgetConfig(updated_at=now, default_monthly_credits=250)
    document = DocumentRecord(created_at=now, updated_at=now, status="processing")

    assert budget.default_monthly_credits == 250
    assert document.status == "processing"
