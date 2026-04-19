import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useSession } from "#/features/auth/hooks/useSession";

/**
 * Mirrors the current session into PostHog: identify on login, reset on logout.
 * No-ops when VITE_POSTHOG_KEY is absent (init guarded in provider.tsx).
 */
export function useIdentifySession() {
	const session = useSession();
	const lastIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!import.meta.env.VITE_POSTHOG_KEY) return;

		const user = session.data;
		if (user && user.id !== lastIdRef.current) {
			posthog.identify(user.id, {
				email: user.email,
				name: user.name,
				role: user.role,
			});
			lastIdRef.current = user.id;
		} else if (!user && lastIdRef.current !== null) {
			posthog.reset();
			lastIdRef.current = null;
		}
	}, [session.data]);
}
