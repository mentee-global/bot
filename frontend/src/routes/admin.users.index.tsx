import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
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
	CompactDate,
	DataTableSkeleton,
	EmptyState,
	ErrorState,
	MobileCardListSkeleton,
	Muted,
	ResultsCount,
	RolePill,
} from "#/features/admin/components/shared";
import {
	parsePageFromSearch,
	parseRoleFromSearch,
	parseStringFromSearch,
	ROLE_ALL,
	ROLE_OPTIONS,
} from "#/features/admin/constants";
import type { AdminUserSummary } from "#/features/admin/data/admin.types";
import { useAdminUsersQuery } from "#/features/admin/hooks/useAdmin";
import { useDebouncedValue } from "#/lib/useDebouncedValue";

type UsersListSearch = {
	q?: string;
	role?: string;
	page?: number;
};

export const Route = createFileRoute("/admin/users/")({
	component: UsersListRoute,
	validateSearch: (search: Record<string, unknown>): UsersListSearch => ({
		q: parseStringFromSearch(search.q),
		role: parseRoleFromSearch(search.role),
		page: parsePageFromSearch(search.page),
	}),
});

function UsersListRoute() {
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

	const handleSelect = (id: string) =>
		navigate({ to: "/admin/users/$userId", params: { userId: id } });

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
				header: "Name",
				accessorFn: (u) => u.name ?? "",
				cell: ({ row }) => (
					<span className="truncate">
						{row.original.name || <Muted>—</Muted>}
					</span>
				),
				sortingFn: "alphanumeric",
				meta: {
					tooltipTitle: "Name",
					tooltip:
						"The display name from the user's MenteeGlobal account. Empty if they haven't set one.",
				},
			},
			{
				id: "email",
				header: "Email",
				accessorKey: "email",
				cell: ({ row }) => (
					<span className="block break-words">{row.original.email}</span>
				),
				sortingFn: "alphanumeric",
				meta: {
					tooltipTitle: "Email",
					tooltip: "The email address used to sign in with Mentee.",
				},
			},
			{
				id: "role",
				header: "Role",
				accessorKey: "role",
				cell: ({ row }) => <RolePill role={row.original.role} />,
				size: 120,
				meta: {
					tooltipTitle: "Role",
					tooltip:
						"What this person is on Mentee. Today only Admins (manage the bot) and Mentees (chat with the mentor) appear here.",
				},
			},
			{
				id: "credits",
				header: "Credits",
				accessorFn: (u) => u.credits_remaining ?? -1,
				cell: ({ row }) => {
					const u = row.original;
					if (u.credits_remaining == null) return <Muted>—</Muted>;
					const granted = u.credits_granted_period ?? 0;
					return (
						<span className="tabular-nums">
							{u.credits_remaining}
							<span className="text-muted-foreground"> / {granted}</span>
						</span>
					);
				},
				size: 130,
				meta: {
					tooltipTitle: "Credits",
					tooltip: (
						<>
							<p className="m-0">
								<b>Remaining / Granted</b> — how many credits the user can still
								spend, vs. how many they were given for the current period.
							</p>
							<p className="m-0 mt-2">
								Credits reset on each user's anniversary date. Open the user to
								grant, revoke, or transfer.
							</p>
						</>
					),
				},
			},
			{
				id: "last_seen",
				header: "Last seen",
				accessorFn: (u) =>
					u.last_used_at ? new Date(u.last_used_at).getTime() : 0,
				cell: ({ row }) =>
					row.original.last_used_at ? (
						<CompactDate iso={row.original.last_used_at} />
					) : (
						<Muted>—</Muted>
					),
				size: 160,
				meta: {
					tooltipTitle: "Last seen",
					tooltip:
						"The most recent time we saw this user — either signing in or sending a message to the mentor.",
				},
			},
		],
		[],
	);

	const userSkeletonColumns = useMemo(
		() => [{}, {}, { width: 120 }, { width: 130 }, { width: 160 }],
		[],
	);

	if (users.isPending && !data) {
		return (
			<section className="flex h-full min-h-0 flex-col gap-4">
				<div className="flex flex-wrap items-center gap-2">
					<div className="min-w-[12rem] flex-1">
						<Input
							type="search"
							value={queryInput}
							onChange={(e) => setQueryInput(e.target.value)}
							placeholder="Filter users by name or email"
							disabled
						/>
					</div>
					<RoleFilter value={role} onChange={handleRoleChange} />
				</div>
				<div className="min-h-0 flex-1 sm:hidden">
					<MobileCardListSkeleton />
				</div>
				<div className="hidden min-h-0 flex-1 flex-col sm:flex">
					<DataTableSkeleton
						columns={userSkeletonColumns}
						rows={12}
						fillHeight
					/>
				</div>
			</section>
		);
	}
	if (users.isError)
		return <ErrorState error={users.error} onRetry={() => users.refetch()} />;

	return (
		<section className="flex h-full min-h-0 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-[12rem] flex-1">
					<Input
						type="search"
						value={queryInput}
						onChange={(e) => setQueryInput(e.target.value)}
						placeholder="Filter users by name or email"
					/>
				</div>
				<RoleFilter value={role} onChange={handleRoleChange} />
			</div>

			{rows.length === 0 && !users.isFetching ? (
				<EmptyState
					message={
						debounced
							? `No results for "${debounced}".`
							: "No users have signed in yet."
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
					<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto sm:hidden">
						{rows.map((user) => (
							<UserCard
								key={user.user_id}
								user={user}
								onSelect={() => handleSelect(user.user_id)}
							/>
						))}
					</ul>
					{/* Desktop: sortable data table that flex-fills the admin shell. */}
					<div className="hidden min-h-0 flex-1 flex-col sm:flex">
						<DataTable
							data={rows}
							columns={userColumns}
							onRowClick={(u) => handleSelect(u.user_id)}
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
					{user.last_used_at ? (
						<CompactDate iso={user.last_used_at} />
					) : (
						<Muted>—</Muted>
					)}
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
			<SelectTrigger aria-label="Filter by role">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ROLE_ALL}>All roles</SelectItem>
				{ROLE_OPTIONS.map((opt) => (
					<SelectItem key={opt} value={opt}>
						{opt.charAt(0).toUpperCase() + opt.slice(1)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
