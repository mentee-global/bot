import { PostHogProvider as BasePostHogProvider } from "@posthog/react";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useIdentifySession } from "#/integrations/posthog/useIdentifySession";

if (typeof window !== "undefined" && import.meta.env.VITE_POSTHOG_KEY) {
	posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
		api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
		person_profiles: "identified_only",
		// SPA-aware pageview capture — fires on history.pushState / popstate so
		// every TanStack Router navigation produces a $pageview without the route
		// tree having to know about analytics.
		capture_pageview: "history_change",
		// Session replay: per product decision, record without masking. The chat
		// surface intentionally captures full content; users have agreed via the
		// Mentee ToS. To revoke this, flip disable_session_recording back to true
		// OR set maskAllInputs/maskTextSelector and recompile.
		disable_session_recording: false,
		session_recording: {
			maskAllInputs: false,
		},
		defaults: "2025-11-30",
	});

	// Catch JS errors that escape React's render tree — uncaught errors from
	// setTimeout/promises, native event handlers, etc. The mutationCache hook
	// covers TanStack Query errors; these two listeners cover the rest.
	window.addEventListener("error", (event) => {
		posthog.captureException(
			event.error ?? new Error(event.message || "window.error"),
		);
	});
	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		posthog.captureException(
			reason instanceof Error ? reason : new Error(String(reason)),
		);
	});
}

interface PostHogProviderProps {
	children: ReactNode;
}

function SessionIdentifier() {
	useIdentifySession();
	return null;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
	return (
		<BasePostHogProvider client={posthog}>
			<SessionIdentifier />
			{children}
		</BasePostHogProvider>
	);
}
