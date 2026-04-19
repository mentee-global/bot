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
	 */
	startLogin: (opts?: { redirectTo?: string }) => {
		const qs = opts?.redirectTo
			? `?redirect_to=${encodeURIComponent(opts.redirectTo)}`
			: "";
		window.location.href = `${API_URL}/api/auth/login${qs}`;
	},
	logout: () => api.post<{ ok: boolean }>("/api/auth/logout"),
};
