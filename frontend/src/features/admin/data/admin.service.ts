import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type {
	AdminForceLogoutResponse,
	AdminStatsResponse,
	AdminThreadListResponse,
	AdminThreadResponse,
	AdminUserListResponse,
	AdminUserSessionsResponse,
} from "#/features/admin/data/admin.types";
import { api } from "#/lib/api/client";

export interface UserListParams {
	query?: string;
	role?: string;
	page?: number;
}

export interface ThreadListParams {
	query?: string;
	page?: number;
}

function buildQuery(params: Record<string, string | number | undefined>) {
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === "" || value === null) continue;
		qs.set(key, String(value));
	}
	const s = qs.toString();
	return s ? `?${s}` : "";
}

export const adminService = {
	listUsers: (params: UserListParams = {}, signal?: AbortSignal) =>
		api.get<AdminUserListResponse>(
			`/api/admin/users${buildQuery({
				q: params.query,
				role: params.role,
				page: params.page,
			})}`,
			signal,
		),
	listUserThreads: (
		menteeSub: string,
		params: ThreadListParams = {},
		signal?: AbortSignal,
	) =>
		api.get<AdminThreadListResponse>(
			`/api/admin/users/${encodeURIComponent(menteeSub)}/threads${buildQuery({
				q: params.query,
				page: params.page,
			})}`,
			signal,
		),
	listAllThreads: (params: ThreadListParams = {}, signal?: AbortSignal) =>
		api.get<AdminThreadListResponse>(
			`/api/admin/threads${buildQuery({
				q: params.query,
				page: params.page,
			})}`,
			signal,
		),
	readThread: (threadId: string, signal?: AbortSignal) =>
		api.get<AdminThreadResponse>(
			`/api/admin/threads/${encodeURIComponent(threadId)}`,
			signal,
		),
	getStats: (signal?: AbortSignal) =>
		api.get<AdminStatsResponse>("/api/admin/stats", signal),
	getUserSessions: (menteeSub: string, signal?: AbortSignal) =>
		api.get<AdminUserSessionsResponse>(
			`/api/admin/users/${encodeURIComponent(menteeSub)}/sessions`,
			signal,
		),
	deleteThread: (threadId: string) =>
		api.delete<void>(`/api/admin/threads/${encodeURIComponent(threadId)}`),
	forceLogout: (menteeSub: string) =>
		api.post<AdminForceLogoutResponse>(
			`/api/admin/users/${encodeURIComponent(menteeSub)}/force-logout`,
		),
};

export const adminKeys = {
	all: ["admin"] as const,
	users: (params: UserListParams = {}) =>
		[...adminKeys.all, "users", params] as const,
	userThreads: (menteeSub: string, params: ThreadListParams = {}) =>
		[...adminKeys.all, "userThreads", menteeSub, params] as const,
	userSessions: (menteeSub: string) =>
		[...adminKeys.all, "userSessions", menteeSub] as const,
	thread: (threadId: string) => [...adminKeys.all, "thread", threadId] as const,
	allThreads: (params: ThreadListParams = {}) =>
		[...adminKeys.all, "allThreads", params] as const,
	stats: () => [...adminKeys.all, "stats"] as const,
};

export const adminUsersQueryOptions = (params: UserListParams = {}) =>
	queryOptions({
		queryKey: adminKeys.users(params),
		queryFn: ({ signal }) => adminService.listUsers(params, signal),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminUserThreadsQueryOptions = (
	menteeSub: string,
	params: ThreadListParams = {},
) =>
	queryOptions({
		queryKey: adminKeys.userThreads(menteeSub, params),
		queryFn: ({ signal }) =>
			adminService.listUserThreads(menteeSub, params, signal),
		enabled: Boolean(menteeSub),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminUserSessionsQueryOptions = (menteeSub: string) =>
	queryOptions({
		queryKey: adminKeys.userSessions(menteeSub),
		queryFn: ({ signal }) => adminService.getUserSessions(menteeSub, signal),
		enabled: Boolean(menteeSub),
		staleTime: 30 * 1000,
	});

export const adminThreadQueryOptions = (threadId: string) =>
	queryOptions({
		queryKey: adminKeys.thread(threadId),
		queryFn: ({ signal }) => adminService.readThread(threadId, signal),
		enabled: Boolean(threadId),
		staleTime: 30 * 1000,
	});

export const adminAllThreadsQueryOptions = (params: ThreadListParams = {}) =>
	queryOptions({
		queryKey: adminKeys.allThreads(params),
		queryFn: ({ signal }) => adminService.listAllThreads(params, signal),
		staleTime: 15 * 1000,
		// Keep the previous page visible while the new query runs so typing in
		// the search box doesn't wipe the table to a loading flash between
		// keystrokes.
		placeholderData: keepPreviousData,
	});

export const adminStatsQueryOptions = queryOptions({
	queryKey: adminKeys.stats(),
	queryFn: ({ signal }) => adminService.getStats(signal),
	staleTime: 15 * 1000,
});
