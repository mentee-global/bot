import {
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { budgetKeys } from "#/features/budget/data/budget.service";
import {
	reportsKeys,
	reportsService,
} from "#/features/reports/data/reports.service";
import type {
	BugReport,
	BugReportCreatePayload,
	BugReportUpdatePayload,
	CreditRequest,
	CreditRequestCreatePayload,
	CreditRequestDenyPayload,
	CreditRequestGrantPayload,
	ReportCreatedResponse,
} from "#/features/reports/data/reports.types";

// ---- User-facing -----------------------------------------------------------

export function useSubmitBugReportMutation() {
	const queryClient = useQueryClient();
	return useMutation<ReportCreatedResponse, Error, BugReportCreatePayload>({
		mutationFn: (payload) => reportsService.submitBugReport(payload),
		onSuccess: () => {
			// If an admin happens to be viewing the queue, refresh it. Cheap because
			// the cache only has data when admin tabs are mounted.
			queryClient.invalidateQueries({ queryKey: ["admin", "bug-reports"] });
		},
	});
}

export function useSubmitCreditRequestMutation() {
	const queryClient = useQueryClient();
	return useMutation<ReportCreatedResponse, Error, CreditRequestCreatePayload>({
		mutationFn: (payload) => reportsService.submitCreditRequest(payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "credit-requests"] });
		},
	});
}

// ---- Admin lists -----------------------------------------------------------

export function bugReportsQueryOptions(status?: string) {
	return queryOptions({
		queryKey: reportsKeys.bugReports(status),
		queryFn: () => reportsService.listBugReports(status),
		staleTime: 10_000,
	});
}

export function useBugReportsQuery(status?: string) {
	return useQuery(bugReportsQueryOptions(status));
}

export function creditRequestsQueryOptions(status?: string) {
	return queryOptions({
		queryKey: reportsKeys.creditRequests(status),
		queryFn: () => reportsService.listCreditRequests(status),
		staleTime: 10_000,
	});
}

export function useCreditRequestsQuery(status?: string) {
	return useQuery(creditRequestsQueryOptions(status));
}

// ---- Admin mutations -------------------------------------------------------

export function useUpdateBugReportMutation() {
	const queryClient = useQueryClient();
	return useMutation<
		BugReport,
		Error,
		{ id: string; payload: BugReportUpdatePayload }
	>({
		mutationFn: ({ id, payload }) =>
			reportsService.updateBugReport(id, payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "bug-reports"] });
		},
	});
}

export function useGrantCreditRequestMutation() {
	const queryClient = useQueryClient();
	return useMutation<
		CreditRequest,
		Error,
		{ id: string; payload: CreditRequestGrantPayload }
	>({
		mutationFn: ({ id, payload }) =>
			reportsService.grantCreditRequest(id, payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "credit-requests"] });
			// Granting a request bumps the user's quota. Refresh /api/me caches so
			// the admin's own credits pill (and any user viewing this in another tab)
			// reflect the change.
			queryClient.invalidateQueries({ queryKey: budgetKeys.me() });
		},
	});
}

export function useDenyCreditRequestMutation() {
	const queryClient = useQueryClient();
	return useMutation<
		CreditRequest,
		Error,
		{ id: string; payload: CreditRequestDenyPayload }
	>({
		mutationFn: ({ id, payload }) =>
			reportsService.denyCreditRequest(id, payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "credit-requests"] });
		},
	});
}
