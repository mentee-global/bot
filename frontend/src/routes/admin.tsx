import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, LogOut, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
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
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationNext,
	PaginationPrevious,
} from "#/components/ui/pagination";
import { Skeleton } from "#/components/ui/Skeleton";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import type {
	AdminThreadSummary,
	AdminUserSessionsResponse,
	AdminUserSummary,
} from "#/features/admin/data/admin.types";
import {
	useAdminAllThreadsQuery,
	useAdminStatsQuery,
	useAdminThreadQuery,
	useAdminUserSessionsQuery,
	useAdminUsersQuery,
	useAdminUserThreadsQuery,
	useDeleteThreadMutation,
	useForceLogoutMutation,
} from "#/features/admin/hooks/useAdmin";
import { authService } from "#/features/auth/data/auth.service";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import type { Message } from "#/features/chat/data/chat.types";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

type AdminTab = "activity" | "users";

type AdminSearch = {
	tab?: AdminTab;
	userId?: string;
	threadId?: string;
	q?: string;
	role?: string;
	page?: number;
};

// Allowed role filter values. Mirrors ROLE_NAMES on Mentee
// (mentee/backend/api/views/oauth.py) so the dropdown stays in sync with the
// roles that can actually show up in the `role` claim.
const ROLE_OPTIONS = [
	"admin",
	"mentor",
	"mentee",
	"partner",
	"guest",
	"support",
	"hub",
	"moderator",
] as const;

const ROLE_ALL = "__all__";

export const Route = createFileRoute("/admin")({
	component: AdminPage,
	validateSearch: (search: Record<string, unknown>): AdminSearch => {
		const tab = search.tab === "users" ? "users" : undefined;
		const rawRole =
			typeof search.role === "string" ? search.role.toLowerCase() : undefined;
		const role =
			rawRole && ROLE_OPTIONS.includes(rawRole as never) ? rawRole : undefined;
		const rawPage =
			typeof search.page === "number"
				? search.page
				: typeof search.page === "string"
					? Number.parseInt(search.page, 10)
					: undefined;
		const page =
			rawPage !== undefined && Number.isFinite(rawPage) && rawPage > 1
				? rawPage
				: undefined;
		return {
			tab,
			userId: typeof search.userId === "string" ? search.userId : undefined,
			threadId:
				typeof search.threadId === "string" ? search.threadId : undefined,
			q:
				typeof search.q === "string" && search.q.length > 0
					? search.q
					: undefined,
			role,
			page,
		};
	},
});

function AdminPage() {
	const session = useSession();
	const navigate = useNavigate();

	useEffect(() => {
		if (session.isPending) return;
		if (!session.data) {
			// Kick off an admin-hinted login; Mentee shows its /admin login form,
			// backend stashes redirect_to=/admin and lands us back here after auth.
			authService.startLogin({ redirectTo: "/admin", roleHint: "admin" });
			return;
		}
		if (session.data.role !== "admin") {
			// Hide the admin surface from non-admin users. Redirect home rather
			// than rendering an error — mirrors the backend 404 policy.
			navigate({ to: "/" });
		}
	}, [session.isPending, session.data, navigate]);

	if (session.isPending || !session.data) {
		return <AdminShellSkeleton />;
	}

	if (session.data.role !== "admin") {
		return null;
	}

	return <AdminShell />;
}

function AdminShell() {
	const search = Route.useSearch();

	return (
		<main className="page-wrap min-w-0 px-3 py-5 sm:px-6 sm:py-10">
			<AdminHeader />
			<div className="mt-5 sm:mt-6">
				{search.threadId ? (
					<ThreadView threadId={search.threadId} userId={search.userId} />
				) : search.userId ? (
					<UserPageView userId={search.userId} />
				) : (
					<>
						<AdminTabs active={search.tab ?? "activity"} />
						<div className="mt-5">
							{search.tab === "users" ? <UsersView /> : <ActivityView />}
						</div>
					</>
				)}
			</div>
		</main>
	);
}

function AdminHeader() {
	const session = useSession();
	const logout = useLogoutMutation();
	const displayName = session.data?.name || session.data?.email || "";

	return (
		<header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
			<div className="min-w-0 flex-1">
				<p className="island-kicker m-0">{m.admin_kicker()}</p>
				<h1 className="m-0 text-xl font-semibold sm:text-2xl">
					{m.admin_title()}
				</h1>
				{displayName ? (
					<p className="m-0 mt-1 truncate text-sm text-muted-foreground">
						{m.admin_signed_in_as({ name: displayName })}
					</p>
				) : null}
			</div>
			<Button
				variant="outline"
				size="sm"
				onClick={() => logout.mutate()}
				className="shrink-0 gap-1.5"
			>
				<LogOut className="size-3.5" />
				{m.admin_sign_out()}
			</Button>
		</header>
	);
}

function AdminTabs({ active }: { active: AdminTab }) {
	const navigate = useNavigate();
	return (
		<Tabs
			value={active}
			onValueChange={(val) =>
				navigate({
					to: "/admin",
					search: val === "activity" ? {} : { tab: "users" },
				})
			}
		>
			<TabsList
				variant="line"
				className="h-auto w-full justify-start gap-0 rounded-none border-b bg-transparent p-0"
			>
				<TabsTrigger
					value="activity"
					className="rounded-none px-3 py-2 text-sm after:bottom-0"
				>
					{m.admin_tab_activity()}
				</TabsTrigger>
				<TabsTrigger
					value="users"
					className="rounded-none px-3 py-2 text-sm after:bottom-0"
				>
					{m.admin_tab_users()}
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}

// ---------------------------------------------------------------------------
// Activity tab — stats + global thread feed with search
// ---------------------------------------------------------------------------

function ActivityView() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	const page = search.page ?? 1;

	const [queryInput, setQueryInput] = useState(search.q ?? "");
	const debounced = useDebouncedValue(queryInput.trim(), 200);

	// Keep URL in sync with the debounced query. Reset page to 1 whenever the
	// search text changes so the user doesn't land on an out-of-range page.
	useEffect(() => {
		const next = debounced || undefined;
		if (next === (search.q ?? undefined)) return;
		navigate({
			to: "/admin",
			search: { tab: search.tab, q: next },
			replace: true,
		});
	}, [debounced, search.q, search.tab, navigate]);

	// Inverse sync: when URL changes externally (back/forward, tab switch)
	// reflect it back into the local input state.
	useEffect(() => {
		setQueryInput(search.q ?? "");
	}, [search.q]);

	const threads = useAdminAllThreadsQuery({
		query: debounced || undefined,
		page,
	});
	// Owner-lookup table for the activity feed. Pulled with no filter so every
	// owner name can be resolved regardless of the user tab's active filter.
	const users = useAdminUsersQuery();

	const data = threads.data;
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;

	return (
		<section className="flex flex-col gap-5">
			<StatsTiles />

			<Input
				type="search"
				value={queryInput}
				onChange={(e) => setQueryInput(e.target.value)}
				placeholder={m.admin_activity_search_placeholder()}
			/>

			{threads.isPending ? (
				<LoadingState />
			) : threads.isError ? (
				<ErrorState message={threads.error.message} />
			) : (data?.threads.length ?? 0) === 0 ? (
				<EmptyState
					message={
						debounced
							? m.admin_search_no_results({ query: debounced })
							: m.admin_activity_empty()
					}
				/>
			) : (
				<>
					<ResultsCount
						total={total}
						pageSize={pageSize}
						page={page}
						shown={data?.threads.length ?? 0}
					/>
					<ActivityList
						threads={data?.threads ?? []}
						users={users.data?.users ?? []}
						onSelect={(threadId, ownerId) =>
							navigate({
								to: "/admin",
								search: { userId: ownerId, threadId },
							})
						}
					/>
					<AdminPagination
						page={page}
						total={total}
						pageSize={pageSize}
						onChange={(next) =>
							navigate({
								to: "/admin",
								search: {
									tab: search.tab,
									q: search.q,
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

function StatsTiles() {
	const stats = useAdminStatsQuery();
	const tiles = [
		{ label: m.admin_stat_users(), value: stats.data?.users },
		{ label: m.admin_stat_threads(), value: stats.data?.threads },
		{ label: m.admin_stat_messages(), value: stats.data?.messages },
		{ label: m.admin_stat_messages_24h(), value: stats.data?.messages_24h },
	];
	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
			{tiles.map((tile) => (
				<Card key={tile.label} className="gap-1.5 py-4">
					<CardContent className="px-4">
						<p className="m-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{tile.label}
						</p>
						<p className="m-0 mt-1 text-2xl font-semibold">
							{stats.isPending ? (
								<Skeleton className="h-6 w-12" />
							) : (
								(tile.value ?? 0).toLocaleString()
							)}
						</p>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function ActivityList({
	threads,
	users,
	onSelect,
}: {
	threads: AdminThreadSummary[];
	users: AdminUserSummary[];
	onSelect: (threadId: string, ownerId: string) => void;
}) {
	const byId = new Map(users.map((u) => [u.mentee_sub, u]));
	const ownerLabel = (id: string) => {
		const user = byId.get(id);
		if (!user) return m.admin_owner_unknown();
		return user.name || user.email || id;
	};

	return (
		<>
			{/* Mobile: stacked cards. */}
			<ul className="flex flex-col gap-2 sm:hidden">
				{threads.map((t) => (
					<li key={t.thread_id}>
						<button
							type="button"
							onClick={() => onSelect(t.thread_id, t.owner_user_id)}
							className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:bg-accent/50"
						>
							<p className="m-0 truncate text-sm font-medium">
								{t.title || <Muted>{m.admin_thread_untitled()}</Muted>}
							</p>
							<p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
								{ownerLabel(t.owner_user_id)}
							</p>
							<p className="m-0 mt-1 text-xs text-muted-foreground">
								<CompactDate iso={t.updated_at} />
							</p>
						</button>
					</li>
				))}
			</ul>
			{/* Desktop: table. */}
			<Card className="hidden overflow-hidden p-0 sm:block">
				<Table>
					<colgroup>
						<col className="w-[45%]" />
						<col className="w-[30%]" />
						<col className="w-[25%]" />
					</colgroup>
					<TableHeader>
						<TableRow>
							<TableHead>{m.admin_col_title()}</TableHead>
							<TableHead>{m.admin_col_owner()}</TableHead>
							<TableHead>{m.admin_col_updated()}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{threads.map((t) => (
							<TableRow
								key={t.thread_id}
								onClick={() => onSelect(t.thread_id, t.owner_user_id)}
								className="cursor-pointer"
							>
								<TableCell className="max-w-0">
									<span className="block truncate">
										{t.title || <Muted>{m.admin_thread_untitled()}</Muted>}
									</span>
								</TableCell>
								<TableCell className="max-w-0">
									<span className="block truncate">
										{ownerLabel(t.owner_user_id)}
									</span>
								</TableCell>
								<TableCell>
									<CompactDate iso={t.updated_at} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>
		</>
	);
}

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

function UsersView() {
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
			to: "/admin",
			search: { tab: "users", q: next, role },
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

	if (users.isPending) return <LoadingState />;
	if (users.isError) return <ErrorState message={users.error.message} />;

	const data = users.data;
	const rows = data?.users ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;

	const handleSelect = (menteeSub: string) =>
		navigate({ to: "/admin", search: { userId: menteeSub } });

	const handleRoleChange = (next: string | undefined) => {
		navigate({
			to: "/admin",
			search: { tab: "users", q: search.q, role: next },
		});
	};

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

			{rows.length === 0 ? (
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
					{/* Desktop: table. */}
					<Card className="hidden overflow-hidden p-0 sm:block">
						<Table>
							<colgroup>
								<col className="w-[22%]" />
								<col className="w-[38%]" />
								<col className="w-[15%]" />
								<col className="w-[25%]" />
							</colgroup>
							<TableHeader>
								<TableRow>
									<TableHead>{m.admin_col_name()}</TableHead>
									<TableHead>{m.admin_col_email()}</TableHead>
									<TableHead>{m.admin_col_role()}</TableHead>
									<TableHead>{m.admin_col_last_seen()}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((user) => (
									<UserRow
										key={user.mentee_sub}
										user={user}
										onSelect={() => handleSelect(user.mentee_sub)}
									/>
								))}
							</TableBody>
						</Table>
					</Card>
					<AdminPagination
						page={page}
						total={total}
						pageSize={pageSize}
						onChange={(next) =>
							navigate({
								to: "/admin",
								search: {
									tab: "users",
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

function UserRow({
	user,
	onSelect,
}: {
	user: AdminUserSummary;
	onSelect: () => void;
}) {
	return (
		<TableRow onClick={onSelect} className="cursor-pointer">
			<TableCell>
				<span className="truncate">{user.name || <Muted>—</Muted>}</span>
			</TableCell>
			<TableCell className="max-w-0">
				<span className="block break-words">{user.email}</span>
			</TableCell>
			<TableCell>
				<RolePill role={user.role} />
			</TableCell>
			<TableCell>
				<CompactDate iso={user.last_used_at} />
			</TableCell>
		</TableRow>
	);
}

// ---------------------------------------------------------------------------
// Per-user page — sessions panel + threads
// ---------------------------------------------------------------------------

function UserPageView({ userId }: { userId: string }) {
	const search = Route.useSearch();
	const page = search.page ?? 1;
	const threads = useAdminUserThreadsQuery(userId, { page });
	const users = useAdminUsersQuery();
	const navigate = useNavigate();

	const user = users.data?.users.find((u) => u.mentee_sub === userId);
	const displayName = user?.name || user?.email || userId;

	if (threads.isPending) return <LoadingState />;
	if (threads.isError) return <ErrorState message={threads.error.message} />;

	const data = threads.data;
	const rows = data?.threads ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;
	const handleSelect = (threadId: string) =>
		navigate({ to: "/admin", search: { userId, threadId } });

	return (
		<section className="flex flex-col gap-5">
			<BackLink to={{ to: "/admin", search: {} }}>
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
				{rows.length === 0 ? (
					<EmptyState message={m.admin_threads_empty()} />
				) : (
					<div className="flex flex-col gap-4">
						<ResultsCount
							total={total}
							pageSize={pageSize}
							page={page}
							shown={rows.length}
						/>
						<ul className="flex flex-col gap-2 sm:hidden">
							{rows.map((t) => (
								<ThreadCard
									key={t.thread_id}
									thread={t}
									onSelect={() => handleSelect(t.thread_id)}
								/>
							))}
						</ul>
						<Card className="hidden overflow-hidden p-0 sm:block">
							<Table>
								<colgroup>
									<col className="w-[70%]" />
									<col className="w-[30%]" />
								</colgroup>
								<TableHeader>
									<TableRow>
										<TableHead>{m.admin_col_title()}</TableHead>
										<TableHead>{m.admin_col_updated()}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{rows.map((t) => (
										<ThreadRow
											key={t.thread_id}
											thread={t}
											onSelect={() => handleSelect(t.thread_id)}
										/>
									))}
								</TableBody>
							</Table>
						</Card>
						<AdminPagination
							page={page}
							total={total}
							pageSize={pageSize}
							onChange={(next) =>
								navigate({
									to: "/admin",
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

function StatItem({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div>
			<dt className="m-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="m-0 mt-0.5 text-sm font-medium">{value}</dd>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Per-thread view — with export + delete
// ---------------------------------------------------------------------------

function ThreadView({
	threadId,
	userId,
}: {
	threadId: string;
	userId: string | undefined;
}) {
	const thread = useAdminThreadQuery(threadId);
	const navigate = useNavigate();
	const deleteMutation = useDeleteThreadMutation();
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (thread.isPending) return <LoadingState />;
	if (thread.isError) return <ErrorState message={thread.error.message} />;

	const data = thread.data;
	if (!data) return <EmptyState message={m.admin_thread_empty()} />;

	const title = data.title || m.admin_thread_untitled();

	const handleDelete = () => {
		deleteMutation.mutate(threadId, {
			onSuccess: () => {
				setConfirmOpen(false);
				navigate({
					to: "/admin",
					search: userId ? { userId } : {},
				});
			},
		});
	};

	return (
		<section>
			<BackLink
				to={{
					to: "/admin",
					search: userId ? { userId } : {},
				}}
			>
				{m.admin_back_threads()}
			</BackLink>
			<div className="mt-3 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="m-0 break-words text-lg font-semibold">{title}</h2>
					<p className="m-0 mt-1 break-all text-xs text-muted-foreground">
						{m.admin_thread_owner({ id: data.owner_user_id })}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => downloadThread(data, title)}
						className="gap-1.5"
					>
						<Download className="size-3.5" /> {m.admin_export_json()}
					</Button>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => setConfirmOpen(true)}
						className="gap-1.5"
					>
						<Trash2 className="size-3.5" /> {m.admin_delete_thread()}
					</Button>
				</div>
			</div>
			<div className="mt-4">
				{data.messages.length === 0 ? (
					<EmptyState message={m.admin_thread_empty()} />
				) : (
					<Card className="gap-3 p-3 sm:p-6">
						{data.messages.map((message) => (
							<AdminMessage key={message.id} message={message} />
						))}
					</Card>
				)}
			</div>

			<ConfirmDeleteDialog
				open={confirmOpen}
				title={title}
				pending={deleteMutation.isPending}
				onCancel={() => setConfirmOpen(false)}
				onConfirm={handleDelete}
			/>
		</section>
	);
}

function AdminMessage({ message }: { message: Message }) {
	const isUser = message.role === "user";
	return (
		<div
			className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
		>
			<div
				className={cn(
					"max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[80%] sm:px-4",
					isUser
						? "bg-primary text-primary-foreground"
						: "border border-border bg-muted text-foreground",
				)}
			>
				<p className="m-0 whitespace-pre-wrap break-words leading-relaxed">
					{message.body}
				</p>
				<p
					className={cn(
						"m-0 mt-2 text-[10px] uppercase tracking-wide",
						isUser ? "text-primary-foreground/70" : "text-muted-foreground",
					)}
				>
					{message.role} · <CompactDate iso={message.created_at} />
				</p>
			</div>
		</div>
	);
}

function downloadThread(
	data: {
		thread_id: string;
		title: string | null;
		owner_user_id: string;
		messages: Message[];
	},
	fallbackTitle: string,
) {
	const payload = {
		...data,
		exported_at: new Date().toISOString(),
	};
	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	// Keep filenames filesystem-friendly. Strip anything but alnum/dash/underscore.
	const safeTitle = (data.title || fallbackTitle)
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.slice(0, 40);
	a.download = `thread-${safeTitle || data.thread_id.slice(0, 8)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Shared UI bits
// ---------------------------------------------------------------------------

function ThreadCard({
	thread,
	onSelect,
}: {
	thread: AdminThreadSummary;
	onSelect: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				onClick={onSelect}
				className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:bg-accent/50"
			>
				<p className="m-0 text-sm font-medium">
					{thread.title || <Muted>{m.admin_thread_untitled()}</Muted>}
				</p>
				<p className="m-0 mt-1 text-xs text-muted-foreground">
					<CompactDate iso={thread.updated_at} />
				</p>
			</button>
		</li>
	);
}

function ThreadRow({
	thread,
	onSelect,
}: {
	thread: AdminThreadSummary;
	onSelect: () => void;
}) {
	return (
		<TableRow onClick={onSelect} className="cursor-pointer">
			<TableCell className="max-w-0">
				<span className="block truncate">
					{thread.title || <Muted>{m.admin_thread_untitled()}</Muted>}
				</span>
			</TableCell>
			<TableCell>
				<CompactDate iso={thread.updated_at} />
			</TableCell>
		</TableRow>
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

function ResultsCount({
	total,
	pageSize,
	page,
	shown,
}: {
	total: number;
	pageSize: number;
	page: number;
	shown: number;
}) {
	if (total === 0) return null;
	const from = (page - 1) * pageSize + 1;
	const to = (page - 1) * pageSize + shown;
	return (
		<p className="m-0 text-xs text-muted-foreground">
			{m.admin_results_count({ from, to, total })}
		</p>
	);
}

function AdminPagination({
	page,
	total,
	pageSize,
	onChange,
}: {
	page: number;
	total: number;
	pageSize: number;
	onChange: (page: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	if (totalPages <= 1) return null;
	const canPrev = page > 1;
	const canNext = page < totalPages;
	return (
		<Pagination aria-label={m.admin_pagination_label()}>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						onClick={(e) => {
							e.preventDefault();
							if (canPrev) onChange(page - 1);
						}}
						className={cn(!canPrev && "pointer-events-none opacity-50")}
						aria-disabled={!canPrev}
					/>
				</PaginationItem>
				<PaginationItem>
					<span className="flex items-center px-2 text-xs text-muted-foreground">
						{m.admin_page_indicator({ page, total: totalPages })}
					</span>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext
						onClick={(e) => {
							e.preventDefault();
							if (canNext) onChange(page + 1);
						}}
						className={cn(!canNext && "pointer-events-none opacity-50")}
						aria-disabled={!canNext}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

function RolePill({ role }: { role: string }) {
	return (
		<Badge
			variant={role === "admin" ? "default" : "outline"}
			className="text-[10px] uppercase tracking-wide"
		>
			{role || "—"}
		</Badge>
	);
}

function CompactDate({ iso }: { iso: string }) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return <>—</>;
	const short = date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
	return (
		<time
			dateTime={iso}
			title={date.toLocaleString()}
			className="whitespace-nowrap"
		>
			{short}
		</time>
	);
}

function Muted({ children }: { children: ReactNode }) {
	return <span className="text-muted-foreground">{children}</span>;
}

function EmptyState({ message }: { message: string }) {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-muted-foreground">{message}</p>
		</Card>
	);
}

function LoadingState() {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-muted-foreground">{m.admin_loading()}</p>
		</Card>
	);
}

function ErrorState({ message }: { message: string }) {
	return (
		<Card className="items-center justify-center py-10">
			<p className="text-sm text-destructive">{message}</p>
		</Card>
	);
}

function BackLink({
	to,
	children,
}: {
	to: { to: "/admin"; search: AdminSearch };
	children: ReactNode;
}) {
	const navigate = useNavigate();
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => navigate(to)}
			className="gap-1 px-0 text-xs text-muted-foreground hover:text-foreground"
		>
			<ArrowLeft size={14} /> {children}
		</Button>
	);
}

function AdminShellSkeleton() {
	return (
		<main className="page-wrap px-3 py-5 sm:px-6 sm:py-10">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="mt-6 h-64 rounded-xl" />
		</main>
	);
}

// ---------------------------------------------------------------------------
// Confirm dialogs
// ---------------------------------------------------------------------------

function ConfirmDeleteDialog({
	open,
	title,
	pending,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : null)}>
			<DialogContent>
				<DialogTitle>{m.admin_delete_thread_title()}</DialogTitle>
				<DialogDescription>
					{m.admin_delete_thread_body({ title })}
				</DialogDescription>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel} disabled={pending}>
						{m.common_cancel()}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? m.admin_delete_thread_pending()
							: m.admin_delete_thread_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
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
