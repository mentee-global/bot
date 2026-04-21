import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	adminAllThreadsQueryOptions,
	adminKeys,
	adminService,
	adminStatsQueryOptions,
	adminThreadQueryOptions,
	adminUserSessionsQueryOptions,
	adminUsersQueryOptions,
	adminUserThreadsQueryOptions,
	type ThreadListParams,
	type UserListParams,
} from "#/features/admin/data/admin.service";

export function useAdminUsersQuery(params: UserListParams = {}) {
	return useQuery(adminUsersQueryOptions(params));
}

export function useAdminUserThreadsQuery(
	menteeSub: string | null,
	params: ThreadListParams = {},
) {
	return useQuery(adminUserThreadsQueryOptions(menteeSub ?? "", params));
}

export function useAdminUserSessionsQuery(menteeSub: string | null) {
	return useQuery(adminUserSessionsQueryOptions(menteeSub ?? ""));
}

export function useAdminThreadQuery(threadId: string | null) {
	return useQuery(adminThreadQueryOptions(threadId ?? ""));
}

export function useAdminAllThreadsQuery(params: ThreadListParams = {}) {
	return useQuery(adminAllThreadsQueryOptions(params));
}

export function useAdminStatsQuery() {
	return useQuery(adminStatsQueryOptions);
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
		mutationFn: (menteeSub: string) => adminService.forceLogout(menteeSub),
		onSuccess: (_, menteeSub) => {
			queryClient.invalidateQueries({
				queryKey: adminKeys.userSessions(menteeSub),
			});
			queryClient.invalidateQueries({ queryKey: adminKeys.all });
		},
	});
}
