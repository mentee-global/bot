import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp, Mail, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "#/features/admin/components/shared";
import type {
	CreditRequest,
	CreditRequestStatus,
} from "#/features/reports/data/reports.types";
import {
	useCreditRequestsQuery,
	useDenyCreditRequestMutation,
	useGrantCreditRequestMutation,
} from "#/features/reports/hooks/useReports";

const STATUS_FILTERS: {
	label: string;
	value: CreditRequestStatus | "all";
}[] = [
	{ label: "New", value: "new" },
	{ label: "Granted", value: "granted" },
	{ label: "Denied", value: "denied" },
	{ label: "All", value: "all" },
];

type CreditRequestsSearch = {
	status?: CreditRequestStatus | "all";
};

export const Route = createFileRoute("/admin/credit-requests")({
	component: CreditRequestsRoute,
	validateSearch: (search: Record<string, unknown>): CreditRequestsSearch => {
		const raw = search.status;
		if (typeof raw !== "string") return {};
		const allowed: (CreditRequestStatus | "all")[] = [
			"new",
			"granted",
			"denied",
			"all",
		];
		return allowed.includes(raw as CreditRequestStatus | "all")
			? { status: raw as CreditRequestStatus | "all" }
			: {};
	},
});

function CreditRequestsRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const filter = search.status ?? "new";
	const apiStatus = filter === "all" ? undefined : filter;

	const query = useCreditRequestsQuery(apiStatus);

	return (
		<section className="flex min-w-0 flex-col gap-4">
			<Tabs
				value={filter}
				onValueChange={(next) => {
					navigate({
						to: "/admin/credit-requests",
						search: {
							status:
								next === "new"
									? undefined
									: (next as CreditRequestStatus | "all"),
						},
						replace: true,
					});
				}}
			>
				<TabsList variant="line">
					{STATUS_FILTERS.map((f) => (
						<TabsTrigger key={f.value} value={f.value}>
							{f.label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{query.isPending ? (
				<LoadingState />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : query.data.requests.length === 0 ? (
				<EmptyState message="No credit requests match this filter." />
			) : (
				<div className="flex flex-col gap-3">
					{query.data.requests.map((req) => (
						<CreditRequestRow key={req.id} request={req} />
					))}
				</div>
			)}
		</section>
	);
}

function statusBadgeVariant(
	status: CreditRequestStatus,
): "default" | "destructive" | "secondary" | "outline" {
	if (status === "new") return "destructive";
	if (status === "granted") return "default";
	return "outline";
}

function CreditRequestRow({ request }: { request: CreditRequest }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<Card id={request.id} className="gap-3 px-5 py-4 text-sm">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex flex-wrap items-center gap-2">
						<Badge
							variant={statusBadgeVariant(request.status)}
							className="text-[10px] uppercase"
						>
							{request.status}
						</Badge>
						{request.requested_amount ? (
							<span className="rounded bg-[var(--theme-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-primary)]">
								asks for {request.requested_amount}
							</span>
						) : null}
						{request.current_credits_remaining !== null ? (
							<span className="rounded bg-[var(--theme-surface)] px-1.5 py-0.5 text-[10px] text-[var(--theme-muted)]">
								balance {request.current_credits_remaining}
							</span>
						) : null}
						{!request.email_sent ? (
							<span
								className="inline-flex items-center gap-1 rounded bg-[var(--theme-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--theme-danger)]"
								title={request.email_error ?? "Email not sent"}
							>
								<Mail className="size-3" /> not emailed
							</span>
						) : null}
					</div>
					<p className="m-0 truncate font-medium text-[var(--theme-primary)]">
						{request.user_email}
					</p>
					<p className="m-0 line-clamp-1 text-xs text-[var(--theme-secondary)]">
						{request.reason}
					</p>
				</div>
				<div className="flex items-center gap-3 text-xs text-[var(--theme-secondary)]">
					<span>{new Date(request.created_at).toLocaleString()}</span>
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="inline-flex items-center gap-1 rounded-md border border-[var(--theme-border)] px-2 py-1 text-[var(--theme-primary)] transition hover:border-[var(--theme-accent)]"
					>
						{expanded ? (
							<>
								<ChevronUp className="size-3.5" /> Hide
							</>
						) : (
							<>
								<ChevronDown className="size-3.5" /> Open
							</>
						)}
					</button>
				</div>
			</div>

			{expanded ? <CreditRequestDetail request={request} /> : null}
		</Card>
	);
}

function CreditRequestDetail({ request }: { request: CreditRequest }) {
	const [amount, setAmount] = useState<string>(
		request.requested_amount ? String(request.requested_amount) : "",
	);
	const [notes, setNotes] = useState(request.admin_notes ?? "");
	const grant = useGrantCreditRequestMutation();
	const deny = useDenyCreditRequestMutation();

	const isOpen = request.status === "new";
	const parsed = Number.parseInt(amount, 10);
	const canGrant =
		isOpen &&
		Number.isFinite(parsed) &&
		parsed > 0 &&
		parsed <= 100000 &&
		!grant.isPending &&
		!deny.isPending;

	function handleGrant(e: FormEvent) {
		e.preventDefault();
		if (!canGrant) return;
		grant.mutate({
			id: request.id,
			payload: { amount: parsed, notes: notes.trim() || null },
		});
	}

	function handleDeny() {
		if (!isOpen || deny.isPending || grant.isPending) return;
		deny.mutate({
			id: request.id,
			payload: { notes: notes.trim() || null },
		});
	}

	return (
		<div className="flex flex-col gap-4 border-t border-[var(--theme-border)] pt-3">
			<div>
				<p className="mb-1 text-xs font-semibold uppercase text-[var(--theme-secondary)]">
					Reason
				</p>
				<p className="m-0 whitespace-pre-wrap text-[var(--theme-primary)]">
					{request.reason}
				</p>
			</div>

			<div className="grid gap-2 text-xs text-[var(--theme-secondary)] sm:grid-cols-2">
				<div>
					<span className="font-medium">User:</span> {request.user_email}
				</div>
				{request.current_credits_remaining !== null ? (
					<div>
						<span className="font-medium">Current balance:</span>{" "}
						{request.current_credits_remaining}
					</div>
				) : null}
				{request.granted_at ? (
					<div>
						<span className="font-medium">
							{request.status === "granted" ? "Granted" : "Denied"}:
						</span>{" "}
						{new Date(request.granted_at).toLocaleString()} by{" "}
						{request.granted_by_email}
					</div>
				) : null}
				{request.granted_amount ? (
					<div>
						<span className="font-medium">Granted amount:</span>{" "}
						{request.granted_amount} credits
					</div>
				) : null}
				{request.email_error ? (
					<div className="text-[var(--theme-danger)]">
						<span className="font-medium">Email error:</span>{" "}
						{request.email_error}
					</div>
				) : null}
			</div>

			{isOpen ? (
				<form onSubmit={handleGrant} className="flex flex-col gap-3">
					<label className="flex flex-col gap-1 text-xs">
						<span className="font-semibold uppercase text-[var(--theme-secondary)]">
							Amount to grant
						</span>
						<input
							type="number"
							min={1}
							max={100000}
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
							placeholder="e.g. 100"
						/>
					</label>
					<label className="flex flex-col gap-1 text-xs">
						<span className="font-semibold uppercase text-[var(--theme-secondary)]">
							Notes (optional)
						</span>
						<textarea
							value={notes}
							onChange={(e) => setNotes(e.target.value)}
							rows={2}
							className="resize-vertical rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
						/>
					</label>
					<div className="flex flex-wrap items-center justify-end gap-2">
						{grant.isError ? (
							<span className="text-xs text-[var(--theme-danger)]">
								Grant failed — try again.
							</span>
						) : null}
						{deny.isError ? (
							<span className="text-xs text-[var(--theme-danger)]">
								Deny failed — try again.
							</span>
						) : null}
						<button
							type="button"
							onClick={handleDeny}
							className="btn-secondary inline-flex items-center gap-1.5"
							disabled={!isOpen || deny.isPending || grant.isPending}
						>
							<X className="size-3.5" />
							{deny.isPending ? "Denying…" : "Deny"}
						</button>
						<button
							type="submit"
							className="btn-primary inline-flex items-center gap-1.5"
							disabled={!canGrant}
						>
							<Check className="size-3.5" />
							{grant.isPending ? "Granting…" : "Grant credits"}
						</button>
					</div>
				</form>
			) : (
				<div className="rounded-md bg-[var(--theme-surface)] px-3 py-2 text-xs text-[var(--theme-secondary)]">
					This request is {request.status} — no further action available.
				</div>
			)}
		</div>
	);
}
