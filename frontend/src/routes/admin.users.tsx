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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { DataTable } from "#/features/admin/components/DataTable";
import {
	AdminPagination,
	BackLink,
	CompactDate,
	EmptyState,
	ErrorState,
	LoadingState,
	Muted,
	ResultsCount,
	RolePill,
	StatItem,
} from "#/features/admin/components/shared";
import { ThreadView } from "#/features/admin/components/ThreadView";
import {
	parsePageFromSearch,
	parseRoleFromSearch,
	parseStringFromSearch,
	ROLE_ALL,
	ROLE_OPTIONS,
} from "#/features/admin/constants";
import type {
	AdminThreadSummary,
	AdminUserSessionsResponse,
	AdminUserSummary,
} from "#/features/admin/data/admin.types";
import {
	useAdminUserSessionsQuery,
	useAdminUsersQuery,
	useAdminUserThreadsQuery,
	useForceLogoutMutation,
} from "#/features/admin/hooks/useAdmin";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { m } from "#/paraglide/messages";

type UsersSearch = {
	q?: string;
	role?: string;
	userId?: string;
	threadId?: string;
	page?: number;
};

export const Route = createFileRoute("/admin/users")({
	component: UsersRoute,
	validateSearch: (search: Record<string, unknown>): UsersSearch => ({
		q: parseStringFromSearch(search.q),
		role: parseRoleFromSearch(search.role),
		userId: parseStringFromSearch(search.userId),
		threadId: parseStringFromSearch(search.threadId),
		page: parsePageFromSearch(search.page),
	}),
});

function UsersRoute() {
	const search = Route.useSearch();

	if (search.threadId && search.userId) {
		return <UserThreadView userId={search.userId} threadId={search.threadId} />;
	}
	if (search.userId) {
		return <UserDetailView userId={search.userId} />;
	}
	return <UsersList />;
}

function UserThreadView({
	userId,
	threadId,
}: {
	userId: string;
	threadId: string;
}) {
	const navigate = useNavigate();
	const backToUser = () => navigate({ to: "/admin/users", search: { userId } });
	return (
		<ThreadView
			threadId={threadId}
			backLabel={m.admin_back_threads()}
			onBack={backToUser}
			onDeleted={backToUser}
		/>
	);
}

// ---------------------------------------------------------------------------
// Users list
// ---------------------------------------------------------------------------

function UsersList() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const page = search.page ?? 1;
	const role = search.role;

	const [queryInput, setQueryInput] = useState(search.q ?? "");
	const debounced = useDebouncedValue(queryInput.trim(), 200);

	useEffect(() => {
		const next = debounced || undefined;
		if (next === (search.q ?? undefined)) return;
		navigate({
			to: "/admin/users",
			search: { q: next, role },
			replace: true,
		});
	}, [debounced, search.q, role, navigate]);

	useEffect(() => {
		setQueryInput(search.q ?? "");
	}, [search.q]);

	const users = useAdminUsersQuery({
		query: debounced || undefined,
		role,
		page,
	});

	const data = users.data;
	const rows = data?.users ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;

	const handleSelect = (menteeSub: string) =>
		navigate({ to: "/admin/users", search: { userId: menteeSub } });

	const handleRoleChange = (next: string | undefined) => {
		navigate({
			to: "/admin/users",
			search: { q: search.q, role: next },
		});
	};

	const userColumns = useMemo<ColumnDef<AdminUserSummary>[]>(
		() => [
			{
				id: "name",
				header: m.admin_col_name(),
				accessorFn: (u) => u.name ?? "",
				cell: ({ row }) => (
					<span className="truncate">
						{row.original.name || <Muted>—</Muted>}
					</span>
				),
				sortingFn: "alphanumeric",
			},
			{
				id: "email",
				header: m.admin_col_email(),
				accessorKey: "email",
				cell: ({ row }) => (
					<span className="block break-words">{row.original.email}</span>
				),
				sortingFn: "alphanumeric",
			},
			{
				id: "role",
				header: m.admin_col_role(),
				accessorKey: "role",
				cell: ({ row }) => <RolePill role={row.original.role} />,
				size: 120,
			},
			{
				id: "last_seen",
				header: m.admin_col_last_seen(),
				accessorFn: (u) => new Date(u.last_used_at).getTime(),
				cell: ({ row }) => <CompactDate iso={row.original.last_used_at} />,
				size: 160,
			},
		],
		[],
	);

	if (users.isPending && !data) return <LoadingState />;
	if (users.isError) return <ErrorState message={users.error.message} />;

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-[12rem] flex-1">
					<Input
						type="search"
						value={queryInput}
						onChange={(e) => setQueryInput(e.target.value)}
						placeholder={m.admin_user_search_placeholder()}
					/>
				</div>
				<RoleFilter value={role} onChange={handleRoleChange} />
			</div>

			{rows.length === 0 && !users.isFetching ? (
				<EmptyState
					message={
						debounced
							? m.admin_search_no_results({ query: debounced })
							: m.admin_users_empty()
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
					{/* Mobile: stacked cards. */}
					<ul className="flex flex-col gap-2 sm:hidden">
						{rows.map((user) => (
							<UserCard
								key={user.mentee_sub}
								user={user}
								onSelect={() => handleSelect(user.mentee_sub)}
							/>
						))}
					</ul>
					{/* Desktop: sortable data table. */}
					<div className="hidden sm:block">
						<DataTable
							data={rows}
							columns={userColumns}
							onRowClick={(u) => handleSelect(u.mentee_sub)}
							isFetching={users.isFetching}
							initialSorting={[{ id: "last_seen", desc: true }]}
							fillHeight
						/>
					</div>
					<AdminPagination
						page={page}
						total={total}
						pageSize={pageSize}
						onChange={(next) =>
							navigate({
								to: "/admin/users",
								search: {
									q: search.q,
									role,
									page: next > 1 ? next : undefined,
								},
							})
						}
					/>
				</>
			)}
		</section>
	);
}

function UserCard({
	user,
	onSelect,
}: {
	user: AdminUserSummary;
	onSelect: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:bg-accent/50"
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<p className="m-0 truncate text-sm font-medium">
							{user.name || user.email}
						</p>
						{user.name ? (
							<p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
								{user.email}
							</p>
						) : null}
					</div>
					<RolePill role={user.role} />
				</div>
				<p className="m-0 mt-2 text-xs text-muted-foreground">
					<CompactDate iso={user.last_used_at} />
				</p>
			</button>
		</li>
	);
}

function RoleFilter({
	value,
	onChange,
}: {
	value: string | undefined;
	onChange: (next: string | undefined) => void;
}) {
	return (
		<Select
			value={value ?? ROLE_ALL}
			onValueChange={(val) => onChange(val === ROLE_ALL ? undefined : val)}
		>
			<SelectTrigger aria-label={m.admin_filter_role_label()}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ROLE_ALL}>{m.admin_filter_role_all()}</SelectItem>
				{ROLE_OPTIONS.map((opt) => (
					<SelectItem key={opt} value={opt}>
						{opt.charAt(0).toUpperCase() + opt.slice(1)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

// ---------------------------------------------------------------------------
// Per-user page — sessions panel + threads
// ---------------------------------------------------------------------------

function UserDetailView({ userId }: { userId: string }) {
	const search = Route.useSearch();
	const page = search.page ?? 1;
	const threads = useAdminUserThreadsQuery(userId, { page });
	const users = useAdminUsersQuery();
	const navigate = useNavigate();

	const user = users.data?.users.find((u) => u.mentee_sub === userId);
	const displayName = user?.name || user?.email || userId;

	const data = threads.data;
	const rows = data?.threads ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;
	const handleSelect = (threadId: string) =>
		navigate({ to: "/admin/users", search: { userId, threadId } });

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
			},
			{
				id: "messages",
				header: m.admin_col_messages(),
				accessorKey: "message_count",
				cell: ({ row }) => (
					<span className="tabular-nums">{row.original.message_count}</span>
				),
				size: 100,
			},
			{
				id: "updated",
				header: m.admin_col_updated(),
				accessorFn: (t) => new Date(t.updated_at).getTime(),
				cell: ({ row }) => <CompactDate iso={row.original.updated_at} />,
				size: 160,
			},
		],
		[],
	);

	if (threads.isPending && !data) return <LoadingState />;
	if (threads.isError) return <ErrorState message={threads.error.message} />;

	return (
		<section className="flex flex-col gap-5">
			<BackLink onClick={() => navigate({ to: "/admin/users", search: {} })}>
				{m.admin_back_users()}
			</BackLink>

			<div>
				<h2 className="m-0 break-words text-lg font-semibold">{displayName}</h2>
				{user?.name && user.email ? (
					<p className="m-0 mt-1 truncate text-sm text-muted-foreground">
						{user.email}
					</p>
				) : null}
			</div>

			<UserSessionsPanel userId={userId} displayName={displayName} />

			<div>
				<h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{m.admin_threads_heading()}
				</h3>
				{rows.length === 0 && !threads.isFetching ? (
					<EmptyState message={m.admin_threads_empty()} />
				) : (
					<div className="flex flex-col gap-3">
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
						<div className="hidden sm:block">
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
									to: "/admin/users",
									search: {
										userId,
										page: next > 1 ? next : undefined,
									},
								})
							}
						/>
					</div>
				)}
			</div>
		</section>
	);
}

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
					<p className="m-0 text-sm text-muted-foreground">
						{m.admin_loading()}
					</p>
				) : sessions.isError ? (
					<p className="m-0 text-sm text-destructive">
						{sessions.error.message}
					</p>
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
