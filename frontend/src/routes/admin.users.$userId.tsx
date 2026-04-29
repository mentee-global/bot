import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { DataTable } from "#/features/admin/components/DataTable";
import { Skeleton } from "#/components/ui/Skeleton";
import {
	AdminPagination,
	BackLink,
	CompactDate,
	DataTableSkeleton,
	EmptyState,
	ErrorState,
	MobileCardListSkeleton,
	Muted,
	ResultsCount,
	RolePill,
	StatItem,
	UserQuotaCardSkeleton,
} from "#/features/admin/components/shared";
import { ThreadView } from "#/features/admin/components/ThreadView";
import {
	parsePageFromSearch,
	parseStringFromSearch,
} from "#/features/admin/constants";
import type {
	AdminThreadSummary,
	AdminUserSessionsResponse,
} from "#/features/admin/data/admin.types";
import {
	useAdminUserSessionsQuery,
	useAdminUsersQuery,
	useAdminUserThreadsQuery,
	useForceLogoutMutation,
} from "#/features/admin/hooks/useAdmin";
import { UsageHistoryList } from "#/features/budget/components/UsageHistoryList";
import { UserQuotaCard } from "#/features/budget/components/UserQuotaCard";
import {
	useBudgetUserUsagePageQuery,
	useBudgetUserUsageQuery,
} from "#/features/budget/hooks/useBudget";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { m } from "#/paraglide/messages";

const TABS = ["overview", "conversations", "usage", "sessions"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: unknown): v is Tab =>
	typeof v === "string" && (TABS as readonly string[]).includes(v);

type UserDetailSearch = {
	tab?: Tab;
	threadId?: string;
	q?: string;
	page?: number;
};

export const Route = createFileRoute("/admin/users/$userId")({
	component: UserDetailRoute,
	validateSearch: (search: Record<string, unknown>): UserDetailSearch => ({
		tab: isTab(search.tab) ? search.tab : undefined,
		threadId: parseStringFromSearch(search.threadId),
		q: parseStringFromSearch(search.q),
		page: parsePageFromSearch(search.page),
	}),
});

function UserDetailRoute() {
	const { userId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	if (search.threadId) {
		const backToUser = () =>
			navigate({
				to: "/admin/users/$userId",
				params: { userId },
				search: { tab: "conversations" },
			});
		return (
			<ThreadView
				threadId={search.threadId}
				backLabel={m.admin_back_threads()}
				onBack={backToUser}
				onDeleted={backToUser}
			/>
		);
	}

	return <UserDetailView userId={userId} />;
}

function UserDetailView({ userId }: { userId: string }) {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const tab: Tab = search.tab ?? "overview";

	// Surface basic identity info from the cached users list (which is paginated
	// — so for direct deep-links we may not have it). Falls back to the userId.
	const users = useAdminUsersQuery();
	const user = users.data?.users.find((u) => u.user_id === userId);
	const displayName = user?.name || user?.email || userId;

	const setTab = (next: Tab) => {
		navigate({
			to: "/admin/users/$userId",
			params: { userId },
			search: { tab: next === "overview" ? undefined : next },
			replace: true,
		});
	};

	return (
		<section className="flex h-full min-h-0 flex-col gap-5">
			<BackLink onClick={() => navigate({ to: "/admin/users" })}>
				{m.admin_back_users()}
			</BackLink>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="m-0 break-words text-lg font-semibold">
						{displayName}
					</h2>
					{user?.name && user.email ? (
						<p className="m-0 mt-1 truncate text-sm text-muted-foreground">
							{user.email}
						</p>
					) : null}
				</div>
				{user ? <RolePill role={user.role} /> : null}
			</div>

			<Tabs
				value={tab}
				onValueChange={(v) => isTab(v) && setTab(v)}
				className="flex min-h-0 flex-1 flex-col gap-4"
			>
				<TabsList className="self-start">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="conversations">Conversations</TabsTrigger>
					<TabsTrigger value="usage">Usage</TabsTrigger>
					<TabsTrigger value="sessions">Sessions</TabsTrigger>
				</TabsList>

				<TabsContent
					value="overview"
					className="min-h-0 flex-1 overflow-y-auto"
				>
					<UserOverview userId={userId} />
				</TabsContent>

				<TabsContent
					value="conversations"
					className="flex min-h-0 flex-1 flex-col"
				>
					<UserConversations userId={userId} />
				</TabsContent>

				<TabsContent value="usage" className="min-h-0 flex-1 overflow-y-auto">
					<UserUsage userId={userId} />
				</TabsContent>

				<TabsContent
					value="sessions"
					className="min-h-0 flex-1 overflow-y-auto"
				>
					<UserSessionsPanel userId={userId} displayName={displayName} />
				</TabsContent>
			</Tabs>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Overview tab: quota card + recent usage glance
// ---------------------------------------------------------------------------

function UserOverview({ userId }: { userId: string }) {
	const usage = useBudgetUserUsageQuery(userId);
	if (usage.isPending) return <UserQuotaCardSkeleton />;
	if (usage.isError) {
		return (
			<ErrorState error={usage.error} onRetry={() => usage.refetch()} />
		);
	}
	const data = usage.data;
	if (!data) return null;
	return (
		<div className="flex flex-col gap-4">
			<UserQuotaCard data={data} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Conversations tab: filterable, paginated thread list
// ---------------------------------------------------------------------------

function UserConversations({ userId }: { userId: string }) {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const page = search.page ?? 1;

	const [queryInput, setQueryInput] = useState(search.q ?? "");
	const debounced = useDebouncedValue(queryInput.trim(), 200);

	useEffect(() => {
		const next = debounced || undefined;
		if (next === (search.q ?? undefined)) return;
		navigate({
			to: "/admin/users/$userId",
			params: { userId },
			search: { tab: "conversations", q: next },
			replace: true,
		});
	}, [debounced, search.q, userId, navigate]);

	useEffect(() => {
		setQueryInput(search.q ?? "");
	}, [search.q]);

	const threads = useAdminUserThreadsQuery(userId, {
		query: debounced || undefined,
		page,
	});
	const data = threads.data;
	const rows = data?.threads ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;

	const handleSelect = (threadId: string) =>
		navigate({
			to: "/admin/users/$userId",
			params: { userId },
			search: { tab: "conversations", threadId },
		});

	const threadColumns = useMemo<ColumnDef<AdminThreadSummary>[]>(
		() => [
			{
				id: "title",
				header: m.admin_col_title(),
				accessorFn: (t) => t.title ?? "",
				cell: ({ row }) => (
					<span className="block truncate">
						{row.original.title || <Muted>{m.admin_thread_untitled()}</Muted>}
					</span>
				),
				sortingFn: "alphanumeric",
				meta: {
					tooltipTitle: "Title",
					tooltip:
						"Auto-generated from the first user message, or whatever the user renamed it to. Untitled chats had only one short turn.",
				},
			},
			{
				id: "messages",
				header: m.admin_col_messages(),
				accessorKey: "message_count",
				cell: ({ row }) => (
					<span className="tabular-nums">{row.original.message_count}</span>
				),
				size: 100,
				meta: {
					tooltipTitle: "Messages",
					tooltip:
						"Total turns in this conversation, counting both the user and the mentor.",
				},
			},
			{
				id: "updated",
				header: m.admin_col_updated(),
				accessorFn: (t) => new Date(t.updated_at).getTime(),
				cell: ({ row }) => <CompactDate iso={row.original.updated_at} />,
				size: 160,
				meta: {
					tooltipTitle: "Updated",
					tooltip:
						"When the most recent message was added — either by the user or by the mentor.",
				},
			},
		],
		[],
	);

	const threadSkeletonColumns = useMemo(
		() => [{}, { width: 100, align: "right" as const }, { width: 160 }],
		[],
	);

	if (threads.isError)
		return (
			<ErrorState error={threads.error} onRetry={() => threads.refetch()} />
		);

	const threadsPending = threads.isPending && !data;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<Input
				type="search"
				value={queryInput}
				onChange={(e) => setQueryInput(e.target.value)}
				placeholder="Search this user's conversations by title"
			/>

			{threadsPending ? (
				<>
					<div className="sm:hidden">
						<MobileCardListSkeleton rows={4} />
					</div>
					<div className="hidden min-h-0 flex-1 sm:block">
						<DataTableSkeleton
							columns={threadSkeletonColumns}
							rows={8}
							fillHeight
						/>
					</div>
				</>
			) : rows.length === 0 && !threads.isFetching ? (
				<EmptyState
					message={
						debounced
							? m.admin_search_no_results({ query: debounced })
							: m.admin_threads_empty()
					}
				/>
			) : (
				<>
					<ResultsCount
						total={total}
						pageSize={pageSize}
						page={page}
						shown={rows.length}
					/>
					<ul className="flex flex-col gap-2 sm:hidden">
						{rows.map((t) => (
							<li key={t.thread_id}>
								<button
									type="button"
									onClick={() => handleSelect(t.thread_id)}
									className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:bg-accent/50"
								>
									<p className="m-0 text-sm font-medium">
										{t.title || <Muted>{m.admin_thread_untitled()}</Muted>}
									</p>
									<p className="m-0 mt-1 flex items-center gap-2 text-xs text-muted-foreground">
										<span>
											{m.admin_messages_count({ count: t.message_count })}
										</span>
										<span>·</span>
										<CompactDate iso={t.updated_at} />
									</p>
								</button>
							</li>
						))}
					</ul>
					<div className="hidden min-h-0 flex-1 flex-col sm:flex">
						<DataTable
							data={rows}
							columns={threadColumns}
							onRowClick={(t) => handleSelect(t.thread_id)}
							isFetching={threads.isFetching}
							initialSorting={[{ id: "updated", desc: true }]}
							fillHeight
						/>
					</div>
					<AdminPagination
						page={page}
						total={total}
						pageSize={pageSize}
						onChange={(next) =>
							navigate({
								to: "/admin/users/$userId",
								params: { userId },
								search: {
									tab: "conversations",
									q: search.q,
									page: next > 1 ? next : undefined,
								},
							})
						}
					/>
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Usage tab
// ---------------------------------------------------------------------------

function UserUsage({ userId }: { userId: string }) {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const page = search.page ?? 1;

	const usage = useBudgetUserUsagePageQuery(userId, { page });

	if (usage.isPending && !usage.data) {
		return (
			<DataTableSkeleton
				columns={[
					{},
					{},
					{ width: 90, align: "right" },
					{ width: 90, align: "right" },
					{ width: 70, align: "right" },
					{ width: 110, align: "right" },
					{ width: 90, align: "right" },
				]}
				rows={8}
			/>
		);
	}
	if (usage.isError) {
		return <ErrorState error={usage.error} onRetry={() => usage.refetch()} />;
	}
	const data = usage.data;
	if (!data) return null;

	const goToPage = (next: number) =>
		navigate({
			to: "/admin/users/$userId",
			params: { userId },
			search: { tab: "usage", page: next > 1 ? next : undefined },
		});

	return (
		<div className="flex flex-col gap-3">
			<p className="m-0 text-xs text-muted-foreground">
				Every provider call this user's turns made, newest first. A turn that
				hits OpenAI, Perplexity, and web_search produces one row per provider.
				Hover any column header to learn what it means.
			</p>
			{data.rows.length === 0 ? (
				<EmptyState message="No usage recorded yet for this user." />
			) : (
				<>
					<ResultsCount
						total={data.total}
						pageSize={data.page_size}
						page={page}
						shown={data.rows.length}
					/>
					<UsageHistoryList rows={data.rows} />
					<AdminPagination
						page={page}
						total={data.total}
						pageSize={data.page_size}
						onChange={goToPage}
					/>
				</>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Sessions tab
// ---------------------------------------------------------------------------

function UserSessionsPanel({
	userId,
	displayName,
}: {
	userId: string;
	displayName: string;
}) {
	const sessions = useAdminUserSessionsQuery(userId);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const forceLogout = useForceLogoutMutation();
	const [resultMsg, setResultMsg] = useState<string | null>(null);

	const handleConfirm = () => {
		forceLogout.mutate(userId, {
			onSuccess: (data) => {
				setConfirmOpen(false);
				setResultMsg(
					m.admin_force_logout_result({ count: data.sessions_deleted }),
				);
			},
		});
	};

	return (
		<Card className="gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3 px-6">
				<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{m.admin_sessions_heading()}
				</h3>
				<Button
					variant="destructive"
					size="xs"
					onClick={() => setConfirmOpen(true)}
					disabled={
						sessions.isPending || (sessions.data?.session_count ?? 0) === 0
					}
					className="gap-1.5"
				>
					<LogOut className="size-3.5" /> {m.admin_force_logout()}
				</Button>
			</div>

			{resultMsg ? (
				<p className="m-0 px-6 text-xs text-muted-foreground">{resultMsg}</p>
			) : null}

			<CardContent>
				{sessions.isPending ? (
					<SessionSummarySkeleton />
				) : sessions.isError ? (
					<ErrorState
						error={sessions.error}
						onRetry={() => sessions.refetch()}
					/>
				) : (
					<SessionSummary data={sessions.data} />
				)}
			</CardContent>

			<ConfirmForceLogoutDialog
				open={confirmOpen}
				displayName={displayName}
				pending={forceLogout.isPending}
				onCancel={() => setConfirmOpen(false)}
				onConfirm={handleConfirm}
			/>
		</Card>
	);
}

function SessionSummary({
	data,
}: {
	data: AdminUserSessionsResponse | undefined;
}) {
	if (!data || data.session_count === 0) {
		return (
			<p className="m-0 text-sm text-muted-foreground">
				{m.admin_sessions_empty()}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-4">
			<dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<StatItem label={m.admin_sessions_count()} value={data.session_count} />
				<StatItem
					label={m.admin_sessions_first()}
					value={data.first_seen ? <CompactDate iso={data.first_seen} /> : "—"}
				/>
				<StatItem
					label={m.admin_sessions_last()}
					value={
						data.last_active ? <CompactDate iso={data.last_active} /> : "—"
					}
				/>
			</dl>
			{data.recent_sessions.length > 0 ? (
				<ul className="flex flex-col gap-1.5 border-t pt-3">
					{data.recent_sessions.map((s) => (
						<li
							key={s.session_id_prefix}
							className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground"
						>
							<span className="font-mono">
								{m.admin_session_row_label({ prefix: s.session_id_prefix })}
							</span>
							<span>
								<CompactDate iso={s.last_used_at} />
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function SessionSummarySkeleton() {
	const items = Array.from({ length: 3 }, (_, i) => i);
	return (
		<output
			aria-busy
			aria-label={m.admin_loading()}
			className="flex flex-col gap-4"
		>
			<dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				{items.map((i) => (
					<div key={i}>
						<Skeleton className="h-2.5 w-16" />
						<Skeleton className="mt-2 h-4 w-20" />
					</div>
				))}
			</dl>
			<ul className="flex flex-col gap-1.5 border-t pt-3">
				{items.map((i) => (
					<li
						key={`row-${i}`}
						className="flex items-baseline justify-between gap-2"
					>
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-3 w-20" />
					</li>
				))}
			</ul>
		</output>
	);
}

function ConfirmForceLogoutDialog({
	open,
	displayName,
	pending,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	displayName: string;
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : null)}>
			<DialogContent>
				<DialogTitle>{m.admin_force_logout_title()}</DialogTitle>
				<DialogDescription>
					{m.admin_force_logout_body({ name: displayName })}
				</DialogDescription>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel} disabled={pending}>
						{m.common_cancel()}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? m.admin_force_logout_pending()
							: m.admin_force_logout_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
