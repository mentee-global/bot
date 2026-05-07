import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	adminAllThreadsQueryOptions,
	adminKeys,
	adminMessageReactionsQueryOptions,
	adminMetricsQueryOptions,
	adminRatingsQueryOptions,
	adminService,
	adminStatsQueryOptions,
	adminThreadQueryOptions,
	adminTriggerConfigQueryOptions,
	adminUserSessionsQueryOptions,
	adminUsersQueryOptions,
	adminUserThreadsQueryOptions,
	type MessageReactionsParams,
	type MetricsParams,
	type RatingsListParams,
	type ThreadListParams,
	type UserListParams,
} from "#/features/admin/data/admin.service";
import type {
	FeedbackTriggerConfig,
	UpdateFeedbackTriggerConfigPayload,
} from "#/features/admin/data/admin.types";
import { chatKeys } from "#/features/chat/hooks/chatKeys";

export function useAdminUsersQuery(params: UserListParams = {}) {
	return useQuery(adminUsersQueryOptions(params));
}

export function useAdminUserThreadsQuery(
	userId: string | null,
	params: ThreadListParams = {},
) {
	return useQuery(adminUserThreadsQueryOptions(userId ?? "", params));
}

export function useAdminUserSessionsQuery(userId: string | null) {
	return useQuery(adminUserSessionsQueryOptions(userId ?? ""));
}

export function useAdminThreadQuery(
	threadId: string | null,
	params: { page?: number } = {},
) {
	return useQuery(adminThreadQueryOptions(threadId ?? "", params));
}

export function useAdminAllThreadsQuery(params: ThreadListParams = {}) {
	return useQuery(adminAllThreadsQueryOptions(params));
}

export function useAdminStatsQuery() {
	return useQuery(adminStatsQueryOptions);
}

export function useAdminMetricsQuery(params: MetricsParams = {}) {
	return useQuery(adminMetricsQueryOptions(params));
}

export function useAdminRatingsQuery(params: RatingsListParams = {}) {
	return useQuery(adminRatingsQueryOptions(params));
}

export function useAdminMessageReactionsQuery(
	params: MessageReactionsParams = {},
) {
	return useQuery(adminMessageReactionsQueryOptions(params));
}

export function useAdminTriggerConfigQuery() {
	return useQuery(adminTriggerConfigQueryOptions);
}

export function useUpdateTriggerConfigMutation() {
	const queryClient = useQueryClient();
	return useMutation<
		FeedbackTriggerConfig,
		Error,
		UpdateFeedbackTriggerConfigPayload
	>({
		mutationFn: (payload) => adminService.updateTriggerConfig(payload),
		onSuccess: (data) => {
			// Prime both the admin-side cache (the form sees the new values
			// immediately) AND the user-side cache that the chat trigger hook
			// reads (so the new cadence applies in any open chat tab on this
			// browser without a manual refetch).
			queryClient.setQueryData(adminKeys.triggerConfig(), data);
			queryClient.setQueryData(chatKeys.feedbackTriggerConfig(), data);
		},
	});
}

export function useDeleteThreadMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (threadId: string) => adminService.deleteThread(threadId),
		onSuccess: (_, threadId) => {
			queryClient.removeQueries({ queryKey: adminKeys.thread(threadId) });
			queryClient.invalidateQueries({ queryKey: adminKeys.all });
		},
	});
}

export function useForceLogoutMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (userId: string) => adminService.forceLogout(userId),
		onSuccess: (_, userId) => {
			queryClient.invalidateQueries({
				queryKey: adminKeys.userSessions(userId),
			});
			queryClient.invalidateQueries({ queryKey: adminKeys.all });
		},
	});
}
