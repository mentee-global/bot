import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
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

export function getContext() {
	const queryClient: QueryClient = new QueryClient({
		queryCache: new QueryCache({
			onError: (err) => clearSessionOnUnauthorized(queryClient, err),
		}),
		mutationCache: new MutationCache({
			onError: (err) => clearSessionOnUnauthorized(queryClient, err),
		}),
	});

	return {
		queryClient,
	};
}

export default function TanstackQueryProvider() {}
