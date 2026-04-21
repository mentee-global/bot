import { queryOptions } from "@tanstack/react-query";
import type { MeResponse, User } from "#/features/auth/data/auth.types";
import { API_URL, api } from "#/lib/api/client";
import { ApiError } from "#/lib/api/errors";

async function fetchSession(signal?: AbortSignal): Promise<User | null> {
	try {
		const { user } = await api.get<MeResponse>("/api/auth/me", signal);
		return user;
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) return null;
		throw err;
	}
}

export const sessionQueryOptions = queryOptions({
	queryKey: ["auth", "session"] as const,
	queryFn: ({ signal }) => fetchSession(signal),
	staleTime: 5 * 60 * 1000,
});

export const authService = {
	/**
	 * Full redirect to the backend /api/auth/login endpoint. The backend runs
	 * the PKCE flow, redirects the browser through Mentee, and lands the user
	 * on /chat with a session cookie already set — the frontend never touches
	 * /api/auth/callback.
	 *
	 * `roleHint` is forwarded to Mentee via the `mentee_login_role` authorize
	 * param so unauthenticated users see the matching role-scoped login form
	 * (e.g. /admin, /support). Mentee owns the allowlist; unknown values fall
	 * back to /login.
	 */
	startLogin: (opts?: { redirectTo?: string; roleHint?: string }) => {
		const params = new URLSearchParams();
		if (opts?.redirectTo) params.set("redirect_to", opts.redirectTo);
		if (opts?.roleHint) params.set("role_hint", opts.roleHint);
		const qs = params.toString() ? `?${params.toString()}` : "";
		window.location.href = `${API_URL}/api/auth/login${qs}`;
	},
	logout: () => api.post<{ ok: boolean }>("/api/auth/logout"),
};
