import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	adminAllThreadsQueryOptions,
	adminKeys,
	adminMetricsQueryOptions,
	adminService,
	adminStatsQueryOptions,
	adminThreadQueryOptions,
	adminUserSessionsQueryOptions,
	adminUsersQueryOptions,
	adminUserThreadsQueryOptions,
	type MetricsParams,
	type ThreadListParams,
	type UserListParams,
} from "#/features/admin/data/admin.service";

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
