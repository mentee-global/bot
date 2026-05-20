import { createFileRoute, Link } from "@tanstack/react-router";
import { m } from "#/paraglide/messages";

type ErrorSearch = { reason?: string };

export const Route = createFileRoute("/auth/error")({
	validateSearch: (search: Record<string, unknown>): ErrorSearch => ({
		reason: typeof search.reason === "string" ? search.reason : undefined,
	}),
	component: AuthErrorPage,
});

function AuthErrorPage() {
	const { reason } = Route.useSearch();
	const { message, hint } = translateReason(reason);

	return (
		<main className="page-wrap px-4 pb-16 pt-20 text-center">
			<section className="mx-auto max-w-md">
				<h1 className="display-title mb-3 text-2xl font-bold text-[var(--theme-primary)]">
					{m.auth_error_title()}
				</h1>
				<p className="mb-3 text-[var(--theme-muted)]">{message}</p>
				{hint && (
					<p className="mb-6 text-sm text-[var(--theme-secondary)]">{hint}</p>
				)}
				<Link to="/" className="btn-primary">
					{m.auth_back_home()}
				</Link>
			</section>
		</main>
	);
}

// Reasons mirror the backend's /api/auth/callback → /auth/error mapping
// (backend plan §11). Mentee passes OAuth 2.0 standard error codes through
// verbatim; anything else collapses to "oauth" so we don't leak provider
// internals. Per-reason hints suggest concrete next steps for the common
// silent-bounce failure modes.
function translateReason(reason?: string): { message: string; hint?: string } {
	switch (reason) {
		case "access_denied":
			return {
				message: m.auth_error_denied(),
				hint: m.auth_error_hint_access_denied(),
			};
		case "login_required":
			return { message: m.auth_error_login_required() };
		case "invalid_scope":
		case "missing_params":
		case "oauth":
			return {
				message: m.auth_error_generic(),
				hint: m.auth_error_hint_oauth(),
			};
		default:
			return { message: m.auth_error_unknown() };
	}
}
