import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Skeleton } from "#/components/ui/Skeleton";
import { DataTable } from "#/features/admin/components/DataTable";
import {
	AdminPagination,
	CompactDate,
	EmptyState,
	ErrorState,
	LoadingState,
	Muted,
	ResultsCount,
} from "#/features/admin/components/shared";
import {
	parsePageFromSearch,
	parseStringFromSearch,
} from "#/features/admin/constants";
import type { AdminThreadSummary } from "#/features/admin/data/admin.types";
import {
	useAdminAllThreadsQuery,
	useAdminStatsQuery,
} from "#/features/admin/hooks/useAdmin";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { m } from "#/paraglide/messages";

type ActivitySearch = {
	q?: string;
	page?: number;
};

export const Route = createFileRoute("/admin/activity/")({
	component: ActivityIndexRoute,
	validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
		q: parseStringFromSearch(search.q),
		page: parsePageFromSearch(search.page),
	}),
});

function ActivityIndexRoute() {
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
			to: "/admin/activity",
			search: { q: next },
			replace: true,
		});
	}, [debounced, search.q, navigate]);

	useEffect(() => {
		setQueryInput(search.q ?? "");
	}, [search.q]);

	const threads = useAdminAllThreadsQuery({
		query: debounced || undefined,
		page,
	});

	const data = threads.data;
	const rows = data?.threads ?? [];
	const total = data?.total ?? 0;
	const pageSize = data?.page_size ?? 25;

	const columns = useMemo<ColumnDef<AdminThreadSummary>[]>(
		() => [
			{
				id: "title",
				header: m.admin_col_title(),
				accessorFn: (r) => r.title ?? "",
				cell: ({ row }) => {
					const title = row.original.title;
					return (
						<span className="block truncate">
							{title || <Muted>{m.admin_thread_untitled()}</Muted>}
						</span>
					);
				},
				sortingFn: "alphanumeric",
			},
			{
				id: "owner",
				header: m.admin_col_owner(),
				accessorFn: (r) => r.owner_name || r.owner_email || r.owner_user_id,
				cell: ({ row }) => <OwnerCell thread={row.original} />,
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
				accessorFn: (r) => new Date(r.updated_at).getTime(),
				cell: ({ row }) => <CompactDate iso={row.original.updated_at} />,
				size: 160,
			},
		],
		[],
	);

	const handleSelect = (thread: AdminThreadSummary) =>
		navigate({
			to: "/admin/activity/$threadId",
			params: { threadId: thread.thread_id },
		});

	return (
		<section className="flex flex-col gap-4">
			<StatsTiles />

			<Input
				type="search"
				value={queryInput}
				onChange={(e) => setQueryInput(e.target.value)}
				placeholder={m.admin_activity_search_placeholder()}
			/>

			{threads.isPending && !data ? (
				<LoadingState />
			) : threads.isError ? (
				<ErrorState message={threads.error.message} />
			) : rows.length === 0 && !threads.isFetching ? (
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
						shown={rows.length}
					/>
					{/* Mobile: stacked cards. */}
					<ul className="flex flex-col gap-2 sm:hidden">
						{rows.map((t) => (
							<li key={t.thread_id}>
								<button
									type="button"
									onClick={() => handleSelect(t)}
									className="w-full rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:bg-accent/50"
								>
									<p className="m-0 truncate text-sm font-medium">
										{t.title || <Muted>{m.admin_thread_untitled()}</Muted>}
									</p>
									<p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">
										{t.owner_name || t.owner_email || m.admin_owner_unknown()}
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
					{/* Desktop: sortable data table with its own scroll cap. */}
					<div className="hidden sm:block">
						<DataTable
							data={rows}
							columns={columns}
							onRowClick={handleSelect}
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
								to: "/admin/activity",
								search: {
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

function OwnerCell({ thread }: { thread: AdminThreadSummary }) {
	const label = thread.owner_name || thread.owner_email;
	if (!label) return <Muted>{m.admin_owner_unknown()}</Muted>;
	return (
		<span className="block min-w-0">
			<span className="block truncate">{label}</span>
			{thread.owner_name && thread.owner_email ? (
				<span className="block truncate text-xs text-muted-foreground">
					{thread.owner_email}
				</span>
			) : null}
		</span>
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
