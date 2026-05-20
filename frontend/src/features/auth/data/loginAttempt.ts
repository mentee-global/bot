/**
 * Breadcrumb cookie helpers for detecting silent OAuth drop-offs.
 *
 * The backend sets `mentee_login_attempt=<unix_seconds>` on `/api/auth/login`
 * and deletes it on every `/api/auth/callback` exit path. If the user lands
 * back on the bot landing page with this cookie still present and no session,
 * we know the provider never sent them back — surface a recovery banner.
 *
 * Cookie is intentionally non-HttpOnly so this module can read it.
 */
const COOKIE_NAME = "mentee_login_attempt";

/**
 * Returns the unix-seconds timestamp the attempt was started, or null if the
 * cookie is missing, malformed, or we're rendering on the server.
 */
export function readLoginAttempt(): number | null {
	if (typeof document === "undefined") return null;
	const raw = document.cookie
		.split("; ")
		.find((row) => row.startsWith(`${COOKIE_NAME}=`))
		?.split("=")[1];
	if (!raw) return null;
	const ts = Number.parseInt(raw, 10);
	return Number.isFinite(ts) && ts > 0 ? ts : null;
}

/**
 * Drops the cookie client-side. Used when the user explicitly retries or
 * dismisses the recovery banner so it doesn't flash again on the next visit.
 */
export function clearLoginAttempt(): void {
	if (typeof document === "undefined") return;
	document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`;
}
