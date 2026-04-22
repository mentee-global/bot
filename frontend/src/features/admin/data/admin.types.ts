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
}

export interface AdminStatsResponse {
	users: number;
	threads: number;
	messages: number;
	messages_24h: number;
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
