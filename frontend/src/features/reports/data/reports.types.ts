// snake_case mirrors the FastAPI response shapes — see backend/app/reports/schemas.py.

export type BugStatus = "new" | "in_progress" | "resolved" | "closed";
export type BugPriority = "low" | "medium" | "high" | "critical";
export type CreditRequestStatus = "new" | "granted" | "denied";

export interface BugReport {
	id: string;
	user_id: string | null;
	user_email: string;
	user_name: string | null;
	description: string;
	page_url: string | null;
	user_agent: string | null;
	status: BugStatus;
	priority: BugPriority | null;
	admin_notes: string | null;
	resolved_by_email: string | null;
	resolved_at: string | null;
	email_sent: boolean;
	email_error: string | null;
	created_at: string;
	updated_at: string;
}

export interface BugReportListResponse {
	reports: BugReport[];
}

export interface CreditRequest {
	id: string;
	user_id: string;
	user_email: string;
	reason: string;
	requested_amount: number | null;
	status: CreditRequestStatus;
	granted_amount: number | null;
	granted_by_email: string | null;
	granted_at: string | null;
	admin_notes: string | null;
	current_credits_remaining: number | null;
	email_sent: boolean;
	email_error: string | null;
	created_at: string;
	updated_at: string;
}

export interface CreditRequestListResponse {
	requests: CreditRequest[];
}

export interface ReportCreatedResponse {
	id: string;
	status: string;
	email_sent: boolean;
}

export interface BugReportCreatePayload {
	description: string;
	page_url?: string | null;
	user_agent?: string | null;
	user_email?: string | null;
	user_name?: string | null;
}

export interface CreditRequestCreatePayload {
	reason: string;
	requested_amount?: number | null;
}

export interface BugReportUpdatePayload {
	status?: BugStatus;
	priority?: BugPriority | null;
	admin_notes?: string | null;
}

export interface CreditRequestGrantPayload {
	amount: number;
	notes?: string | null;
}

export interface CreditRequestDenyPayload {
	notes?: string | null;
}
