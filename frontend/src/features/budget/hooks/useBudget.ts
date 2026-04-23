import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type BudgetConfigPatchWithReason,
	budgetConfigHistoryQueryOptions,
	budgetConfigQueryOptions,
	budgetKeys,
	budgetProvidersQueryOptions,
	budgetService,
	budgetStateQueryOptions,
	budgetUserUsageQueryOptions,
	meQueryOptions,
} from "#/features/budget/data/budget.service";
import { ApiError } from "#/lib/api/errors";

export function useMeQuery(opts?: { enabled?: boolean }) {
	return useQuery({
		...meQueryOptions,
		enabled: opts?.enabled ?? true,
		retry: (failureCount, error) => {
			if (error instanceof ApiError && error.status === 401) return false;
			return failureCount < 1;
		},
	});
}

export function useBudgetConfigQuery() {
	return useQuery(budgetConfigQueryOptions);
}

export function useBudgetConfigHistoryQuery() {
	return useQuery(budgetConfigHistoryQueryOptions);
}

export function useBudgetStateQuery() {
	return useQuery(budgetStateQueryOptions);
}

export function useBudgetProvidersQuery() {
	return useQuery(budgetProvidersQueryOptions);
}

export function useRefreshProvidersMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => budgetService.getProviders({ refresh: true }),
		onSuccess: (data) => {
			queryClient.setQueryData(budgetKeys.providers(), data);
		},
	});
}

export function useBudgetUserUsageQuery(userId: string | null) {
	return useQuery(budgetUserUsageQueryOptions(userId ?? ""));
}

function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
	queryClient.invalidateQueries({ queryKey: budgetKeys.all });
	queryClient.invalidateQueries({ queryKey: ["admin"] });
}

export function useUpdateConfigMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: BudgetConfigPatchWithReason) =>
			budgetService.patchConfig(patch),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useUpdateFlagsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: {
			perplexity_degraded?: boolean;
			hard_stopped?: boolean;
		}) => budgetService.patchFlags(body),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useGrantCreditsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			userId,
			amount,
			reason,
		}: {
			userId: string;
			amount: number;
			reason?: string;
		}) => budgetService.grantCredits(userId, amount, reason),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useRevokeCreditsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			userId,
			amount,
			reason,
		}: {
			userId: string;
			amount: number;
			reason?: string;
		}) => budgetService.revokeCredits(userId, amount, reason),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useTransferCreditsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			fromUserId,
			toUserId,
			amount,
			reason,
		}: {
			fromUserId: string;
			toUserId: string;
			amount: number;
			reason?: string;
		}) => budgetService.transferCredits(fromUserId, toUserId, amount, reason),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useResetQuotaMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (userId: string) => budgetService.resetUser(userId),
		onSuccess: () => invalidateAll(queryClient),
	});
}

export function useSetOverrideMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			userId,
			amount,
		}: {
			userId: string;
			amount: number | null;
		}) => budgetService.setOverride(userId, amount),
		onSuccess: () => invalidateAll(queryClient),
	});
}
