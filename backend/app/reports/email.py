"""SendGrid wrapper for admin alerts.

Two alerts: bug reports and credit requests. Both render inline HTML — Mentee
uses inline HTML for these urgent transactional emails too (see
mentee/backend/api/utils/request_utils.py:225). No template system: the body
fits in a screen, recipients are internal, and adding a templating step would
be more code than just rendering an f-string.

When `sendgrid_api_key` is unset the wrapper returns `(False, "...")` instead
of raising. The create endpoints persist either way and surface the error in
the admin row, so dev environments without SendGrid still work end-to-end.
"""

from __future__ import annotations

import asyncio
import html
import logging
from datetime import datetime
from email.utils import parseaddr
from typing import TYPE_CHECKING

from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import From, Mail, To

from app.core.config import Settings

if TYPE_CHECKING:
    from app.reports.db_models import BugReport, CreditRequest

logger = logging.getLogger(__name__)


def _admin_link(settings: Settings, path: str) -> str:
    base = str(settings.frontend_url).rstrip("/")
    return f"{base}{path}"


def _format_dt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def _render_bug_html(report: BugReport, settings: Settings) -> str:
    user_line = (
        f"{html.escape(report.user_name or 'Anonymous')} "
        f"&lt;{html.escape(report.user_email)}&gt;"
    )
    if report.user_id is None:
        user_line += " <em>(visitor — not logged in)</em>"
    page = html.escape(report.page_url or "—")
    ua = html.escape(report.user_agent or "—")
    description = html.escape(report.description).replace("\n", "<br>")
    link = _admin_link(settings, f"/admin/bug-reports#{report.id}")
    return f"""\
<h2>New bug report</h2>
<p><strong>From:</strong> {user_line}</p>
<p><strong>Page:</strong> <code>{page}</code></p>
<p><strong>User-Agent:</strong> <code>{ua}</code></p>
<p><strong>Submitted:</strong> {_format_dt(report.created_at)}</p>
<hr>
<p><strong>Description:</strong></p>
<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; margin: 0;">
{description}
</blockquote>
<hr>
<p><a href="{link}">Open in admin panel</a></p>
"""


def _render_credit_request_html(
    request: CreditRequest,
    *,
    credits_remaining: int | None,
    settings: Settings,
) -> str:
    user_line = f"&lt;{html.escape(request.user_email)}&gt;"
    reason = html.escape(request.reason).replace("\n", "<br>")
    requested = (
        f"{request.requested_amount} credits"
        if request.requested_amount is not None
        else "<em>unspecified</em>"
    )
    balance = (
        f"{credits_remaining} credits remaining"
        if credits_remaining is not None
        else "<em>unknown</em>"
    )
    link = _admin_link(settings, f"/admin/credit-requests#{request.id}")
    return f"""\
<h2>Credit request</h2>
<p><strong>From:</strong> {user_line}</p>
<p><strong>Current balance:</strong> {balance}</p>
<p><strong>Requested:</strong> {requested}</p>
<p><strong>Submitted:</strong> {_format_dt(request.created_at)}</p>
<hr>
<p><strong>Reason:</strong></p>
<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; margin: 0;">
{reason}
</blockquote>
<hr>
<p><a href="{link}">Approve in admin panel</a></p>
"""


class AlertMailer:
    """Stateless wrapper around the SendGrid client."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def configured(self) -> bool:
        return (
            self._settings.sendgrid_api_key is not None
            and self._settings.sender_email is not None
            and bool(self._settings.admin_alert_recipients)
        )

    async def _send(self, *, subject: str, html_body: str) -> tuple[bool, str | None]:
        if not self.configured:
            logger.warning("sendgrid not configured — skipping alert: %s", subject)
            return (False, "sendgrid_not_configured")

        # SendGrid's SDK is sync; offload to a thread so the request handler
        # isn't blocked on the network round-trip.
        api_key = self._settings.sendgrid_api_key
        sender = self._settings.sender_email
        recipients = self._settings.admin_alert_recipients
        assert api_key is not None and sender is not None  # narrowed by .configured

        # Wrap recipients/sender as explicit `To` / `From` objects. Passing
        # `to_emails` as a bare list[str] hits a SDK path that does
        # `dict["email"]` lookups during multi-recipient consolidation and
        # raises `KeyError: 'email'` — using `To(...)` objects bypasses it.
        sender_name, sender_addr = parseaddr(sender)
        from_obj = From(sender_addr or sender, sender_name or None)
        to_objs = [To(addr) for addr in recipients]

        def _send_sync() -> tuple[bool, str | None]:
            try:
                message = Mail(
                    from_email=from_obj,
                    to_emails=to_objs,
                    subject=subject,
                    html_content=html_body,
                )
                client = SendGridAPIClient(api_key.get_secret_value())
                response = client.send(message)
                if 200 <= response.status_code < 300:
                    return (True, None)
                return (False, f"sendgrid_status_{response.status_code}")
            except Exception as err:  # noqa: BLE001 — surface error to DB row
                return (False, f"{type(err).__name__}: {err}"[:500])

        return await asyncio.to_thread(_send_sync)

    async def send_bug_alert(self, report: BugReport) -> tuple[bool, str | None]:
        subject = f"[Bot] Bug report from {report.user_email or 'anonymous'}"
        return await self._send(
            subject=subject,
            html_body=_render_bug_html(report, self._settings),
        )

    async def send_credit_request_alert(
        self,
        request: CreditRequest,
        *,
        credits_remaining: int | None,
    ) -> tuple[bool, str | None]:
        subject = f"[Bot] Credit request from {request.user_email}"
        return await self._send(
            subject=subject,
            html_body=_render_credit_request_html(
                request,
                credits_remaining=credits_remaining,
                settings=self._settings,
            ),
        )
