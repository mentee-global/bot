import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
	authService,
	sessionQueryOptions,
} from "#/features/auth/data/auth.service";
import { m } from "#/paraglide/messages";

interface CallbackSearch {
	code?: string;
}

export const Route = createFileRoute("/auth/callback")({
	validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
		code: typeof search.code === "string" ? search.code : undefined,
	}),
	component: AuthCallbackPage,
});

function AuthCallbackPage() {
	const { code } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);
	const hasRun = useRef(false);

	useEffect(() => {
		if (hasRun.current) return;
		hasRun.current = true;

		if (!code) {
			setError(m.auth_missing_code());
			return;
		}

		authService
			.exchangeCode(code)
			.then(({ user }) => {
				queryClient.setQueryData(sessionQueryOptions.queryKey, user);
				navigate({ to: "/chat" });
			})
			.catch(() => setError(m.auth_signin_failed()));
	}, [code, navigate, queryClient]);

	return (
		<main className="page-wrap px-4 pb-16 pt-20 text-center">
			<section className="mx-auto max-w-md">
				{error ? (
					<>
						<h1 className="display-title mb-3 text-2xl font-bold text-[var(--theme-primary)]">
							{error}
						</h1>
						<a href="/" className="btn-primary">
							{m.auth_back_home()}
						</a>
					</>
				) : (
					<h1 className="display-title text-2xl font-bold text-[var(--theme-primary)]">
						{m.auth_signing_in()}
					</h1>
				)}
			</section>
		</main>
	);
}
