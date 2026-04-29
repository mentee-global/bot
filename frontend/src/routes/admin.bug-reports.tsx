import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, ExternalLink, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	EmptyState,
	ErrorState,
	LoadingState,
} from "#/features/admin/components/shared";
import type {
	BugPriority,
	BugReport,
	BugStatus,
} from "#/features/reports/data/reports.types";
import {
	useBugReportsQuery,
	useUpdateBugReportMutation,
} from "#/features/reports/hooks/useReports";

const STATUS_FILTERS: { label: string; value: BugStatus | "all" }[] = [
	{ label: "New", value: "new" },
	{ label: "In progress", value: "in_progress" },
	{ label: "Resolved", value: "resolved" },
	{ label: "Closed", value: "closed" },
	{ label: "All", value: "all" },
];

type BugReportsSearch = {
	status?: BugStatus | "all";
};

export const Route = createFileRoute("/admin/bug-reports")({
	component: BugReportsRoute,
	validateSearch: (search: Record<string, unknown>): BugReportsSearch => {
		const raw = search.status;
		if (typeof raw !== "string") return {};
		const allowed: (BugStatus | "all")[] = [
			"new",
			"in_progress",
			"resolved",
			"closed",
			"all",
		];
		return allowed.includes(raw as BugStatus | "all")
			? { status: raw as BugStatus | "all" }
			: {};
	},
});

function BugReportsRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const filter = search.status ?? "new";
	const apiStatus = filter === "all" ? undefined : filter;

	const query = useBugReportsQuery(apiStatus);

	return (
		<section className="flex min-w-0 flex-col gap-4">
			<Tabs
				value={filter}
				onValueChange={(next) => {
					navigate({
						to: "/admin/bug-reports",
						search: {
							status: next === "new" ? undefined : (next as BugStatus | "all"),
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
			) : query.data.reports.length === 0 ? (
				<EmptyState message="No bug reports match this filter." />
			) : (
				<div className="flex flex-col gap-3">
					{query.data.reports.map((report) => (
						<BugReportRow key={report.id} report={report} />
					))}
				</div>
			)}
		</section>
	);
}

function statusBadgeVariant(
	status: BugStatus,
): "default" | "destructive" | "secondary" | "outline" {
	switch (status) {
		case "new":
			return "destructive";
		case "in_progress":
			return "default";
		case "resolved":
			return "secondary";
		case "closed":
			return "outline";
	}
}

function priorityBadgeColor(priority: BugPriority | null): string {
	if (priority === "critical") return "bg-[var(--theme-danger)] text-white";
	if (priority === "high")
		return "bg-[var(--theme-danger)]/15 text-[var(--theme-danger)]";
	if (priority === "medium")
		return "bg-[var(--theme-accent)]/20 text-[var(--theme-primary)]";
	if (priority === "low")
		return "bg-[var(--theme-surface)] text-[var(--theme-secondary)]";
	return "bg-[var(--theme-surface)] text-[var(--theme-muted)]";
}

function BugReportRow({ report }: { report: BugReport }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<Card id={report.id} className="gap-3 px-5 py-4 text-sm">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex flex-wrap items-center gap-2">
						<Badge
							variant={statusBadgeVariant(report.status)}
							className="text-[10px] uppercase"
						>
							{report.status.replace("_", " ")}
						</Badge>
						{report.priority ? (
							<span
								className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${priorityBadgeColor(report.priority)}`}
							>
								{report.priority}
							</span>
						) : null}
						{report.user_id === null ? (
							<Badge variant="outline" className="text-[10px]">
								Anonymous
							</Badge>
						) : null}
						{!report.email_sent ? (
							<span
								className="inline-flex items-center gap-1 rounded bg-[var(--theme-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--theme-danger)]"
								title={report.email_error ?? "Email not sent"}
							>
								<Mail className="size-3" /> not emailed
							</span>
						) : null}
					</div>
					<p className="m-0 truncate font-medium text-[var(--theme-primary)]">
						{report.user_name || report.user_email}
					</p>
					<p className="m-0 truncate text-xs text-[var(--theme-secondary)]">
						{report.user_email}
						{report.page_url ? ` · ${report.page_url}` : null}
					</p>
				</div>
				<div className="flex items-center gap-3 text-xs text-[var(--theme-secondary)]">
					<span>{new Date(report.created_at).toLocaleString()}</span>
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

			{expanded ? <BugReportDetail report={report} /> : null}
		</Card>
	);
}

function BugReportDetail({ report }: { report: BugReport }) {
	const [status, setStatus] = useState<BugStatus>(report.status);
	const [priority, setPriority] = useState<BugPriority | "none">(
		report.priority ?? "none",
	);
	const [notes, setNotes] = useState(report.admin_notes ?? "");
	const [savedFlash, setSavedFlash] = useState(false);
	const update = useUpdateBugReportMutation();

	const dirty =
		status !== report.status ||
		(priority === "none"
			? report.priority !== null
			: priority !== report.priority) ||
		(notes.trim() || null) !== (report.admin_notes ?? null);

	function handleSave(e: FormEvent) {
		e.preventDefault();
		update.mutate(
			{
				id: report.id,
				payload: {
					status,
					priority: priority === "none" ? null : priority,
					admin_notes: notes.trim() || null,
				},
			},
			{
				onSuccess: () => {
					setSavedFlash(true);
					window.setTimeout(() => setSavedFlash(false), 1500);
				},
			},
		);
	}

	return (
		<form
			onSubmit={handleSave}
			className="flex flex-col gap-4 border-t border-[var(--theme-border)] pt-3"
		>
			<div>
				<p className="mb-1 text-xs font-semibold uppercase text-[var(--theme-secondary)]">
					Description
				</p>
				<p className="m-0 whitespace-pre-wrap text-[var(--theme-primary)]">
					{report.description}
				</p>
			</div>

			<div className="grid gap-2 text-xs text-[var(--theme-secondary)] sm:grid-cols-2">
				{report.page_url ? (
					<div className="flex items-center gap-1">
						<span className="font-medium">Page:</span>
						<a
							href={report.page_url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
						>
							{report.page_url} <ExternalLink className="size-3" />
						</a>
					</div>
				) : null}
				{report.user_agent ? (
					<div>
						<span className="font-medium">UA:</span> {report.user_agent}
					</div>
				) : null}
				{report.resolved_at ? (
					<div>
						<span className="font-medium">Resolved:</span>{" "}
						{new Date(report.resolved_at).toLocaleString()} by{" "}
						{report.resolved_by_email}
					</div>
				) : null}
				{report.email_error ? (
					<div className="text-[var(--theme-danger)]">
						<span className="font-medium">Email error:</span>{" "}
						{report.email_error}
					</div>
				) : null}
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="flex flex-col gap-1 text-xs">
					<span className="font-semibold uppercase text-[var(--theme-secondary)]">
						Status
					</span>
					<Select
						value={status}
						onValueChange={(v) => setStatus(v as BugStatus)}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="new">New</SelectItem>
							<SelectItem value="in_progress">In progress</SelectItem>
							<SelectItem value="resolved">Resolved</SelectItem>
							<SelectItem value="closed">Closed</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1 text-xs">
					<span className="font-semibold uppercase text-[var(--theme-secondary)]">
						Priority
					</span>
					<Select
						value={priority}
						onValueChange={(v) => setPriority(v as BugPriority | "none")}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">—</SelectItem>
							<SelectItem value="low">Low</SelectItem>
							<SelectItem value="medium">Medium</SelectItem>
							<SelectItem value="high">High</SelectItem>
							<SelectItem value="critical">Critical</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<label className="flex flex-col gap-1 text-xs">
				<span className="font-semibold uppercase text-[var(--theme-secondary)]">
					Admin notes
				</span>
				<textarea
					value={notes}
					onChange={(e) => setNotes(e.target.value)}
					rows={3}
					className="resize-vertical rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--theme-accent)]"
				/>
			</label>

			<div className="flex items-center justify-end gap-2">
				{savedFlash ? (
					<span className="text-xs text-[var(--theme-secondary)]">Saved</span>
				) : null}
				{update.isError ? (
					<span className="text-xs text-[var(--theme-danger)]">
						Save failed — try again.
					</span>
				) : null}
				<button
					type="submit"
					className="btn-primary"
					disabled={!dirty || update.isPending}
				>
					{update.isPending ? "Saving…" : "Save"}
				</button>
			</div>
		</form>
	);
}
