import { queryOptions } from "@tanstack/react-query";
import type {
	BudgetConfig,
	BudgetConfigPatch,
	GlobalSpend,
	MeResponse,
	ProvidersResponse,
	UserQuota,
	UserUsageResponse,
} from "#/features/budget/data/budget.types";
import { api } from "#/lib/api/client";

export const budgetService = {
	getMe: (signal?: AbortSignal) => api.get<MeResponse>("/api/me", signal),
	getConfig: (signal?: AbortSignal) =>
		api.get<BudgetConfig>("/api/admin/budget/config", signal),
	patchConfig: (patch: BudgetConfigPatch) =>
		api.patch<BudgetConfig>("/api/admin/budget/config", patch),
	getGlobalState: (signal?: AbortSignal) =>
		api.get<GlobalSpend>("/api/admin/budget/state", signal),
	getProviders: (opts: { refresh?: boolean } = {}, signal?: AbortSignal) =>
		api.get<ProvidersResponse>(
			`/api/admin/budget/providers${opts.refresh ? "?refresh=true" : ""}`,
			signal,
		),
	patchFlags: (body: {
		perplexity_degraded?: boolean;
		hard_stopped?: boolean;
	}) => api.patch<GlobalSpend>("/api/admin/budget/flags", body),
	getUserUsage: (userId: string, signal?: AbortSignal) =>
		api.get<UserUsageResponse>(
			`/api/admin/budget/users/${encodeURIComponent(userId)}`,
			signal,
		),
	grantCredits: (userId: string, amount: number, reason = "") =>
		api.post<UserQuota>(
			`/api/admin/budget/users/${encodeURIComponent(userId)}/grant`,
			{ amount, reason },
		),
	revokeCredits: (userId: string, amount: number, reason = "") =>
		api.post<UserQuota>(
			`/api/admin/budget/users/${encodeURIComponent(userId)}/revoke`,
			{ amount, reason },
		),
	transferCredits: (
		fromUserId: string,
		toUserId: string,
		amount: number,
		reason = "",
	) =>
		api.post<UserQuota>(
			`/api/admin/budget/users/${encodeURIComponent(fromUserId)}/transfer`,
			{ to_user_id: toUserId, amount, reason },
		),
	resetUser: (userId: string) =>
		api.post<UserQuota>(
			`/api/admin/budget/users/${encodeURIComponent(userId)}/reset`,
		),
	setOverride: (userId: string, amount: number | null) =>
		api.patch<UserQuota>(
			`/api/admin/budget/users/${encodeURIComponent(userId)}/override`,
			{ amount },
		),
};

export const budgetKeys = {
	all: ["budget"] as const,
	me: () => [...budgetKeys.all, "me"] as const,
	config: () => [...budgetKeys.all, "config"] as const,
	state: () => [...budgetKeys.all, "state"] as const,
	providers: () => [...budgetKeys.all, "providers"] as const,
	userUsage: (userId: string) =>
		[...budgetKeys.all, "userUsage", userId] as const,
};

export const meQueryOptions = queryOptions({
	queryKey: budgetKeys.me(),
	queryFn: ({ signal }) => budgetService.getMe(signal),
	staleTime: 30 * 1000,
	// Retry only once — a 401 just means the user hasn't logged in yet.
	retry: 1,
});

export const budgetConfigQueryOptions = queryOptions({
	queryKey: budgetKeys.config(),
	queryFn: ({ signal }) => budgetService.getConfig(signal),
	staleTime: 60 * 1000,
});

export const budgetStateQueryOptions = queryOptions({
	queryKey: budgetKeys.state(),
	queryFn: ({ signal }) => budgetService.getGlobalState(signal),
	staleTime: 15 * 1000,
});

export const budgetProvidersQueryOptions = queryOptions({
	queryKey: budgetKeys.providers(),
	queryFn: ({ signal }) => budgetService.getProviders({}, signal),
	// Provider data is cached server-side for 5 min; refetch on focus but
	// don't spam during navigation.
	staleTime: 60 * 1000,
});

export const budgetUserUsageQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: budgetKeys.userUsage(userId),
		queryFn: ({ signal }) => budgetService.getUserUsage(userId, signal),
		enabled: Boolean(userId),
		staleTime: 15 * 1000,
	});
