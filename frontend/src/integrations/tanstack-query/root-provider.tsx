import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import posthog from "posthog-js";
import { sessionQueryOptions } from "#/features/auth/data/auth.service";
import { ApiError } from "#/lib/api/errors";

// Global 401 handler: once any query or mutation 401s we clear the session
// cache so gated routes (like /chat) fall through to their null-session
// redirect. Beats adding try/catch in every consumer.
function clearSessionOnUnauthorized(client: QueryClient, err: unknown) {
	if (err instanceof ApiError && err.status === 401) {
		// Don't stomp on the session query itself — it already converts 401 to
		// null via ApiError catch in fetchSession.
		client.setQueryData(sessionQueryOptions.queryKey, null);
	}
}

// Anything that already emitted a PostHog event for itself (e.g. the chat
// stream's chat.response_failed) sets this so we don't double-capture it as
// a generic exception. 401s also don't need exception capture — they're an
// expected signal that maps to the session-cleared path.
function captureUnexpectedError(err: unknown) {
	if (!import.meta.env.VITE_POSTHOG_KEY) return;
	if (err instanceof ApiError && err.status === 401) return;
	if (err && typeof err === "object" && "__posthogTracked" in err) return;
	const exc =
		err instanceof Error
			? err
			: new Error(typeof err === "string" ? err : "Unknown error");
	try {
		posthog.captureException(exc);
	} catch {
		// swallow — analytics must never break the UI
	}
}

export function getContext() {
	const queryClient: QueryClient = new QueryClient({
		queryCache: new QueryCache({
			onError: (err) => {
				clearSessionOnUnauthorized(queryClient, err);
				captureUnexpectedError(err);
			},
		}),
		mutationCache: new MutationCache({
			onError: (err) => {
				clearSessionOnUnauthorized(queryClient, err);
				captureUnexpectedError(err);
			},
		}),
	});

	return {
		queryClient,
	};
}

export default function TanstackQueryProvider() {}
