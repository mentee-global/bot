import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useSession } from "#/features/auth/hooks/useSession";
import { getLocale } from "#/paraglide/runtime";

/**
 * Mirrors the current session into PostHog: identify on login, reset on logout.
 * No-ops when VITE_POSTHOG_KEY is absent (init guarded in provider.tsx).
 *
 * Person properties extend Logfire's identity tagging with locale + auth
 * provider so PostHog cohort filters can slice by URL/cookie locale and
 * profile-level language/timezone in parallel.
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
				locale: getLocale(),
				preferred_language: user.preferred_language ?? null,
				timezone: user.timezone ?? null,
				auth_provider: "mentee",
			});
			lastIdRef.current = user.id;
		} else if (!user && lastIdRef.current !== null) {
			posthog.reset();
			lastIdRef.current = null;
		}
	}, [session.data]);
}
