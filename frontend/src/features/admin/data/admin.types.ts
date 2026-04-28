import type { UserRole } from "#/features/auth/data/auth.types";
import type { Message } from "#/features/chat/data/chat.types";

export interface AdminUserSummary {
	user_id: string;
	mentee_sub: string;
	email: string;
	name: string;
	role: UserRole;
	role_id: number;
	picture?: string | null;
	last_used_at: string | null;
	created_at: string;
	credits_remaining?: number | null;
	credits_used_period?: number | null;
	credits_granted_period?: number | null;
	cost_period_micros?: number | null;
}

export interface AdminUserListResponse {
	users: AdminUserSummary[];
	total: number;
	page: number;
	page_size: number;
}

export interface AdminThreadSummary {
	thread_id: string;
	title: string | null;
	user_id: string;
	owner_email: string | null;
	owner_name: string | null;
	message_count: number;
	created_at: string;
	updated_at: string;
}

export interface AdminThreadListResponse {
	threads: AdminThreadSummary[];
	total: number;
	page: number;
	page_size: number;
}

export interface AdminThreadResponse {
	thread_id: string;
	title: string | null;
	user_id: string;
	owner_email: string | null;
	owner_name: string | null;
	created_at: string;
	updated_at: string;
	messages: Message[];
	total_messages: number;
	user_message_count: number;
	assistant_message_count: number;
	// `page`/`page_size` are non-null on the paginated read endpoint and null
	// on `/export` (which returns the full transcript).
	page: number | null;
	page_size: number | null;
}

export interface AdminStatsResponse {
	users: number;
	threads: number;
	messages: number;
	messages_24h: number;
}

export interface AdminMetricsPoint {
	date: string;
	users: number;
	threads: number;
	messages: number;
}

export interface AdminMetricsCostPoint {
	date: string;
	cost_usd_micros: number;
	input_tokens: number;
	output_tokens: number;
	requests: number;
}

export interface AdminMetricsHourPoint {
	hour: number;
	messages: number;
}

export interface AdminMetricsRoleSlice {
	role: string;
	messages: number;
}

export interface AdminMetricsModelSlice {
	model: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd_micros: number;
}

export interface AdminMetricsTopUser {
	user_id: string;
	name: string;
	email: string;
	role: string;
	messages: number;
}

export interface AdminMetricsThreadLengthBucket {
	label: string;
	threads: number;
}

export interface AdminMetricsResponse {
	range_days: number;
	series: AdminMetricsPoint[];
	cost_series: AdminMetricsCostPoint[];
	hour_of_day: AdminMetricsHourPoint[];
	role_breakdown: AdminMetricsRoleSlice[];
	model_breakdown: AdminMetricsModelSlice[];
	top_users: AdminMetricsTopUser[];
	thread_length_distribution: AdminMetricsThreadLengthBucket[];
	totals: AdminStatsResponse;
	new_users_period: number;
	new_threads_period: number;
	new_messages_period: number;
	active_users_period: number;
	avg_messages_per_thread: number;
	cost_period_usd_micros: number;
	input_tokens_period: number;
	output_tokens_period: number;
	requests_period: number;
}

export interface AdminSessionRow {
	session_id_prefix: string;
	created_at: string;
	last_used_at: string;
	access_token_expires_at: string;
}

export interface AdminUserSessionsResponse {
	user_id: string;
	session_count: number;
	first_seen: string | null;
	last_active: string | null;
	recent_sessions: AdminSessionRow[];
}

export interface AdminForceLogoutResponse {
	sessions_deleted: number;
}
