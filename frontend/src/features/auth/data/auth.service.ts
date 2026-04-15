import { queryOptions } from "@tanstack/react-query";
import type { User } from "#/features/auth/data/auth.types";
import { API_URL, api } from "#/lib/api/client";
import { ApiError } from "#/lib/api/errors";

interface MeResponse {
	user: User;
}

interface CallbackResponse {
	user: User;
}

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
	/** Full redirect to the backend login endpoint, which then 302s to /auth/callback. */
	startLogin: () => {
		window.location.href = `${API_URL}/api/auth/login`;
	},
	/** Exchange the OAuth code for a session cookie. Called from /auth/callback. */
	exchangeCode: (code: string) =>
		api.get<CallbackResponse>(
			`/api/auth/callback?code=${encodeURIComponent(code)}`,
		),
	logout: () => api.post<{ ok: boolean }>("/api/auth/logout"),
};
