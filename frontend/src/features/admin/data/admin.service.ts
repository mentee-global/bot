import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type {
	AdminForceLogoutResponse,
	AdminMessageReactionsResponse,
	AdminMetricsResponse,
	AdminRatingsResponse,
	AdminStatsResponse,
	AdminThreadListResponse,
	AdminThreadResponse,
	AdminUserListResponse,
	AdminUserSessionsResponse,
	FeedbackTriggerConfig,
	UpdateFeedbackTriggerConfigPayload,
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

export interface MetricsParams {
	days?: number;
	from?: string;
	to?: string;
}

export interface RatingsListParams {
	page?: number;
	min_stars?: number;
	max_stars?: number;
	has_comment?: boolean;
	q?: string;
}

export interface MessageReactionsParams {
	page?: number;
	rating?: -1 | 1;
	q?: string;
}

function buildQuery(
	params: Record<string, string | number | boolean | undefined>,
) {
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
		userId: string,
		params: ThreadListParams = {},
		signal?: AbortSignal,
	) =>
		api.get<AdminThreadListResponse>(
			`/api/admin/users/${encodeURIComponent(userId)}/threads${buildQuery({
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
	readThread: (
		threadId: string,
		params: { page?: number } = {},
		signal?: AbortSignal,
	) =>
		api.get<AdminThreadResponse>(
			`/api/admin/threads/${encodeURIComponent(threadId)}${buildQuery({
				page: params.page,
			})}`,
			signal,
		),
	exportThread: (threadId: string, signal?: AbortSignal) =>
		api.get<AdminThreadResponse>(
			`/api/admin/threads/${encodeURIComponent(threadId)}/export`,
			signal,
		),
	getStats: (signal?: AbortSignal) =>
		api.get<AdminStatsResponse>("/api/admin/stats", signal),
	getMetrics: (params: MetricsParams = {}, signal?: AbortSignal) =>
		api.get<AdminMetricsResponse>(
			`/api/admin/metrics${buildQuery({
				days: params.days,
				from: params.from,
				to: params.to,
			})}`,
			signal,
		),
	getUserSessions: (userId: string, signal?: AbortSignal) =>
		api.get<AdminUserSessionsResponse>(
			`/api/admin/users/${encodeURIComponent(userId)}/sessions`,
			signal,
		),
	deleteThread: (threadId: string) =>
		api.delete<void>(`/api/admin/threads/${encodeURIComponent(threadId)}`),
	forceLogout: (userId: string) =>
		api.post<AdminForceLogoutResponse>(
			`/api/admin/users/${encodeURIComponent(userId)}/force-logout`,
		),
	listRatings: (params: RatingsListParams = {}, signal?: AbortSignal) =>
		api.get<AdminRatingsResponse>(
			`/api/admin/feedback/ratings${buildQuery({
				page: params.page,
				min_stars: params.min_stars,
				max_stars: params.max_stars,
				has_comment: params.has_comment,
				q: params.q,
			})}`,
			signal,
		),
	listMessageReactions: (
		params: MessageReactionsParams = {},
		signal?: AbortSignal,
	) =>
		api.get<AdminMessageReactionsResponse>(
			`/api/admin/feedback/message-reactions${buildQuery({
				page: params.page,
				rating: params.rating,
				q: params.q,
			})}`,
			signal,
		),
	getTriggerConfig: (signal?: AbortSignal) =>
		api.get<FeedbackTriggerConfig>(
			"/api/admin/config/feedback-trigger",
			signal,
		),
	updateTriggerConfig: (payload: UpdateFeedbackTriggerConfigPayload) =>
		// Typed payloads satisfy `Record<string, unknown>` structurally but
		// lack the index signature TS expects — cast at the boundary.
		api.put<FeedbackTriggerConfig>(
			"/api/admin/config/feedback-trigger",
			payload as unknown as Record<string, unknown>,
		),
};

export const adminKeys = {
	all: ["admin"] as const,
	users: (params: UserListParams = {}) =>
		[...adminKeys.all, "users", params] as const,
	userThreads: (userId: string, params: ThreadListParams = {}) =>
		[...adminKeys.all, "userThreads", userId, params] as const,
	userSessions: (userId: string) =>
		[...adminKeys.all, "userSessions", userId] as const,
	thread: (threadId: string, params: { page?: number } = {}) =>
		[...adminKeys.all, "thread", threadId, params] as const,
	allThreads: (params: ThreadListParams = {}) =>
		[...adminKeys.all, "allThreads", params] as const,
	stats: () => [...adminKeys.all, "stats"] as const,
	metrics: (params: MetricsParams = {}) =>
		[...adminKeys.all, "metrics", params] as const,
	ratings: (params: RatingsListParams = {}) =>
		[...adminKeys.all, "ratings", params] as const,
	messageReactions: (params: MessageReactionsParams = {}) =>
		[...adminKeys.all, "messageReactions", params] as const,
	triggerConfig: () => [...adminKeys.all, "triggerConfig"] as const,
};

export const adminUsersQueryOptions = (params: UserListParams = {}) =>
	queryOptions({
		queryKey: adminKeys.users(params),
		queryFn: ({ signal }) => adminService.listUsers(params, signal),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminUserThreadsQueryOptions = (
	userId: string,
	params: ThreadListParams = {},
) =>
	queryOptions({
		queryKey: adminKeys.userThreads(userId, params),
		queryFn: ({ signal }) =>
			adminService.listUserThreads(userId, params, signal),
		enabled: Boolean(userId),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminUserSessionsQueryOptions = (userId: string) =>
	queryOptions({
		queryKey: adminKeys.userSessions(userId),
		queryFn: ({ signal }) => adminService.getUserSessions(userId, signal),
		enabled: Boolean(userId),
		staleTime: 30 * 1000,
	});

export const adminThreadQueryOptions = (
	threadId: string,
	params: { page?: number } = {},
) =>
	queryOptions({
		queryKey: adminKeys.thread(threadId, params),
		queryFn: ({ signal }) => adminService.readThread(threadId, params, signal),
		enabled: Boolean(threadId),
		staleTime: 30 * 1000,
		// Keep showing the previous page while the next one streams in so the
		// transcript view doesn't blank between page flips.
		placeholderData: keepPreviousData,
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

export const adminMetricsQueryOptions = (params: MetricsParams = {}) =>
	queryOptions({
		queryKey: adminKeys.metrics(params),
		queryFn: ({ signal }) => adminService.getMetrics(params, signal),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminRatingsQueryOptions = (params: RatingsListParams = {}) =>
	queryOptions({
		queryKey: adminKeys.ratings(params),
		queryFn: ({ signal }) => adminService.listRatings(params, signal),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminMessageReactionsQueryOptions = (
	params: MessageReactionsParams = {},
) =>
	queryOptions({
		queryKey: adminKeys.messageReactions(params),
		queryFn: ({ signal }) => adminService.listMessageReactions(params, signal),
		staleTime: 30 * 1000,
		placeholderData: keepPreviousData,
	});

export const adminTriggerConfigQueryOptions = queryOptions({
	queryKey: adminKeys.triggerConfig(),
	queryFn: ({ signal }) => adminService.getTriggerConfig(signal),
	staleTime: 60 * 1000,
});
