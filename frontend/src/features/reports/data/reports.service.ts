import type {
	BugReport,
	BugReportCreatePayload,
	BugReportListResponse,
	BugReportUpdatePayload,
	CreditRequest,
	CreditRequestCreatePayload,
	CreditRequestDenyPayload,
	CreditRequestGrantPayload,
	CreditRequestListResponse,
	ReportCreatedResponse,
} from "#/features/reports/data/reports.types";
import { api } from "#/lib/api/client";

// `api.post`/`api.patch` expect `Record<string, unknown>`. Our typed payloads
// satisfy that shape but lack the `string` index signature TS needs to widen
// to it, so we cast through `unknown` at the boundary — once per call.
type JsonBody = Record<string, unknown>;
const j = <T>(payload: T): JsonBody => payload as unknown as JsonBody;

export const reportsService = {
	// ---- User-facing ----------------------------------------------------
	submitBugReport: (payload: BugReportCreatePayload) =>
		api.post<ReportCreatedResponse>("/api/reports/bugs", j(payload)),
	submitCreditRequest: (payload: CreditRequestCreatePayload) =>
		api.post<ReportCreatedResponse>("/api/reports/credit-requests", j(payload)),

	// ---- Admin ----------------------------------------------------------
	listBugReports: (status?: string) => {
		const qs = status ? `?status=${encodeURIComponent(status)}` : "";
		return api.get<BugReportListResponse>(`/api/admin/bug-reports${qs}`);
	},
	updateBugReport: (id: string, payload: BugReportUpdatePayload) =>
		api.patch<BugReport>(
			`/api/admin/bug-reports/${encodeURIComponent(id)}`,
			j(payload),
		),

	listCreditRequests: (status?: string) => {
		const qs = status ? `?status=${encodeURIComponent(status)}` : "";
		return api.get<CreditRequestListResponse>(
			`/api/admin/credit-requests${qs}`,
		);
	},
	grantCreditRequest: (id: string, payload: CreditRequestGrantPayload) =>
		api.post<CreditRequest>(
			`/api/admin/credit-requests/${encodeURIComponent(id)}/grant`,
			j(payload),
		),
	denyCreditRequest: (id: string, payload: CreditRequestDenyPayload) =>
		api.post<CreditRequest>(
			`/api/admin/credit-requests/${encodeURIComponent(id)}/deny`,
			j(payload),
		),
};

export const reportsKeys = {
	bugReports: (status?: string) =>
		["admin", "bug-reports", status ?? "all"] as const,
	creditRequests: (status?: string) =>
		["admin", "credit-requests", status ?? "all"] as const,
};
