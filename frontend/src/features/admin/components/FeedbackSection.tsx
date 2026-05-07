import { Link } from "@tanstack/react-router";
import { Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	LabelList,
	XAxis,
	YAxis,
} from "recharts";
import { Card, CardContent } from "#/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart";
import { Input } from "#/components/ui/input";
import { Skeleton } from "#/components/ui/Skeleton";
import {
	ChartCard,
	ChartSkeleton,
	EmptyChart,
	longDate,
	shortDate,
} from "#/features/admin/components/ChartPrimitives";
import {
	AdminPagination,
	CompactDate,
	ErrorState,
} from "#/features/admin/components/shared";
import type {
	AdminMessageReactionRow,
	AdminMetricsFeedback,
	AdminRatingRow,
} from "#/features/admin/data/admin.types";
import {
	useAdminMessageReactionsQuery,
	useAdminMetricsQuery,
	useAdminRatingsQuery,
} from "#/features/admin/hooks/useAdmin";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { cn } from "#/lib/utils";

// ---------------------------------------------------------------------------
// Overview — KPIs + the two summary charts. Always visible at the top of the
// /admin/feedback page so admins land on the at-a-glance state.
// ---------------------------------------------------------------------------

export function FeedbackOverview() {
	const metrics = useAdminMetricsQuery({ days: 30 });
	const feedback = metrics.data?.feedback;
	const loading = metrics.isPending;

	if (metrics.isError) {
		return (
			<ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			<FeedbackKpis feedback={feedback} loading={loading} />
			<div className="grid min-w-0 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
				<StarDistributionChart feedback={feedback} loading={loading} />
				<AvgRatingTrendChart feedback={feedback} loading={loading} />
			</div>
		</div>
	);
}

function FeedbackKpis({
	feedback,
	loading,
}: {
	feedback: AdminMetricsFeedback | undefined;
	loading: boolean;
}) {
	const tiles = [
		{
			label: "Avg session rating",
			value:
				feedback?.avg_rating_period !== null &&
				feedback?.avg_rating_period !== undefined
					? feedback.avg_rating_period.toFixed(2)
					: "—",
		},
		{
			label: "Sessions rated",
			value: feedback ? feedback.total_ratings_period.toLocaleString() : "—",
		},
		{
			label: "Thumbs up rate",
			value:
				feedback && feedback.thumbs_up_rate !== null
					? `${(feedback.thumbs_up_rate * 100).toFixed(0)}%`
					: "—",
		},
		{
			label: "Thumbs (up / down)",
			value: feedback
				? `${feedback.thumbs_up_period.toLocaleString()} / ${feedback.thumbs_down_period.toLocaleString()}`
				: "—",
		},
	];

	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
			{tiles.map((tile) => (
				<Card key={tile.label} className="gap-1 py-3 sm:gap-1.5 sm:py-4">
					<CardContent className="px-3 sm:px-4">
						<p className="m-0 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{tile.label}
						</p>
						<div className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl">
							{loading ? <Skeleton className="h-5 w-12 sm:h-6" /> : tile.value}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function StarDistributionChart({
	feedback,
	loading,
}: {
	feedback: AdminMetricsFeedback | undefined;
	loading: boolean;
}) {
	const config: ChartConfig = {
		count: { label: "Sessions", color: "var(--theme-accent)" },
	};
	const isEmpty =
		feedback?.star_distribution.every((b) => b.count === 0) ?? true;

	return (
		<ChartCard
			title="Star distribution"
			description="How users rated their conversations on a 1–5 scale."
		>
			{loading || !feedback ? (
				<ChartSkeleton />
			) : isEmpty ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-52 w-full sm:h-56">
					<BarChart
						data={feedback.star_distribution}
						margin={{ left: 8, right: 12, top: 12 }}
					>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="stars"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickFormatter={(n: number) => `${n}★`}
						/>
						<YAxis
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							width={32}
							allowDecimals={false}
						/>
						<ChartTooltip
							cursor={false}
							content={
								<ChartTooltipContent
									indicator="dot"
									labelFormatter={(value) =>
										typeof value === "number" ? `${value} stars` : value
									}
								/>
							}
						/>
						<Bar
							dataKey="count"
							fill="var(--color-count)"
							radius={[4, 4, 0, 0]}
						>
							<LabelList
								dataKey="count"
								position="top"
								className="fill-muted-foreground text-[10px]"
							/>
						</Bar>
					</BarChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

function AvgRatingTrendChart({
	feedback,
	loading,
}: {
	feedback: AdminMetricsFeedback | undefined;
	loading: boolean;
}) {
	const config: ChartConfig = {
		avg_stars: { label: "Avg rating", color: "var(--theme-accent)" },
	};
	const isEmpty =
		feedback?.avg_rating_series.every((p) => p.count === 0) ?? true;

	return (
		<ChartCard
			title="Average rating over time"
			description="Daily average of submitted star ratings."
		>
			{loading || !feedback ? (
				<ChartSkeleton />
			) : isEmpty ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-52 w-full sm:h-56">
					<AreaChart
						data={feedback.avg_rating_series}
						margin={{ left: 8, right: 12 }}
					>
						<defs>
							<linearGradient id="fill-avg-stars" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-avg_stars)"
									stopOpacity={0.5}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-avg_stars)"
									stopOpacity={0.05}
								/>
							</linearGradient>
						</defs>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="date"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={32}
							tickFormatter={shortDate}
						/>
						<YAxis
							domain={[1, 5]}
							ticks={[1, 2, 3, 4, 5]}
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							width={28}
						/>
						<ChartTooltip
							cursor={false}
							content={
								<ChartTooltipContent
									indicator="dot"
									labelFormatter={(value) =>
										typeof value === "string" ? longDate(value) : value
									}
									formatter={(value) => {
										if (value === null || value === undefined) {
											return (
												<span className="text-muted-foreground">
													No ratings
												</span>
											);
										}
										const n = typeof value === "number" ? value : 0;
										return (
											<span className="font-mono font-medium tabular-nums">
												{n.toFixed(2)}
											</span>
										);
									}}
								/>
							}
						/>
						<Area
							dataKey="avg_stars"
							type="natural"
							connectNulls
							fill="url(#fill-avg-stars)"
							stroke="var(--color-avg_stars)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

// ---------------------------------------------------------------------------
// Session ratings table — every star rating, with star-band filter pills
// and a debounced search across user, title, and comment.
// ---------------------------------------------------------------------------

type StarFilter = "all" | "low" | "high";

const STAR_FILTERS: { value: StarFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "low", label: "1–2★" },
	{ value: "high", label: "4–5★" },
];

function filterToParams(filter: StarFilter): {
	min_stars?: number;
	max_stars?: number;
} {
	if (filter === "low") return { max_stars: 2 };
	if (filter === "high") return { min_stars: 4 };
	return {};
}

export function SessionRatingsTable() {
	const [page, setPage] = useState(1);
	const [filter, setFilter] = useState<StarFilter>("all");
	const [searchInput, setSearchInput] = useState("");
	const debouncedSearch = useDebouncedValue(searchInput.trim(), 250);
	const query = useAdminRatingsQuery({
		page,
		...filterToParams(filter),
		...(debouncedSearch ? { q: debouncedSearch } : {}),
	});
	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;
	const pageSize = query.data?.page_size ?? 25;

	const handleFilter = (next: StarFilter) => {
		setFilter(next);
		setPage(1);
	};

	const handleSearch = (next: string) => {
		setSearchInput(next);
		setPage(1);
	};

	return (
		<ChartCard
			title="Session ratings"
			description="Every 1–5 star rating users have left. Click a row to open the conversation."
		>
			<TableToolbar
				searchValue={searchInput}
				onSearchChange={handleSearch}
				searchPlaceholder="Search user, title, or comment…"
				filterPills={
					<FilterPills
						value={filter}
						onChange={handleFilter}
						options={STAR_FILTERS}
					/>
				}
			/>

			{query.isPending ? (
				<TableSkeleton />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : items.length === 0 ? (
				<EmptyTable
					message={
						debouncedSearch
							? "No ratings match your search."
							: "No ratings in this range yet."
					}
				/>
			) : (
				<div className="flex flex-col gap-3">
					<ul className="flex flex-col divide-y divide-[var(--theme-border)]">
						{items.map((row) => (
							<SessionRatingRowItem key={row.thread_id} row={row} />
						))}
					</ul>
					<TableFooter
						page={query.data?.page ?? page}
						total={total}
						pageSize={pageSize}
						items={items.length}
						onPageChange={setPage}
					/>
				</div>
			)}
		</ChartCard>
	);
}

function SessionRatingRowItem({ row }: { row: AdminRatingRow }) {
	return (
		<li>
			<Link
				to="/admin/activity/$threadId"
				params={{ threadId: row.thread_id }}
				className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 transition hover:bg-accent/40"
			>
				<StarsBadge stars={row.stars} />
				<div className="min-w-0">
					<p className="m-0 truncate text-sm font-medium">
						{row.title || "(untitled conversation)"}
					</p>
					<p className="m-0 truncate text-xs text-muted-foreground">
						{row.owner_email ?? row.owner_name ?? row.user_id}
						{row.comment ? <> · "{row.comment}"</> : null}
					</p>
				</div>
				<div className="text-xs text-muted-foreground">
					<CompactDate iso={row.rated_at} />
				</div>
			</Link>
		</li>
	);
}

function StarsBadge({ stars }: { stars: number }) {
	const tone =
		stars <= 2
			? "text-[var(--theme-danger)]"
			: stars >= 4
				? "text-[var(--theme-accent)]"
				: "text-[var(--theme-secondary)]";
	return (
		<span
			className={cn("font-mono text-sm font-semibold tabular-nums w-10", tone)}
		>
			{stars}★
		</span>
	);
}

// ---------------------------------------------------------------------------
// Message reactions table — per-message thumbs feedback.
// ---------------------------------------------------------------------------

type ThumbFilter = "all" | "up" | "down";

const THUMB_FILTERS: { value: ThumbFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "up", label: "Up" },
	{ value: "down", label: "Down" },
];

function thumbFilterToParam(filter: ThumbFilter): -1 | 1 | undefined {
	if (filter === "up") return 1;
	if (filter === "down") return -1;
	return undefined;
}

export function MessageReactionsTable() {
	const [page, setPage] = useState(1);
	const [filter, setFilter] = useState<ThumbFilter>("all");
	const [searchInput, setSearchInput] = useState("");
	const debouncedSearch = useDebouncedValue(searchInput.trim(), 250);
	const rating = thumbFilterToParam(filter);
	const query = useAdminMessageReactionsQuery({
		page,
		...(rating !== undefined ? { rating } : {}),
		...(debouncedSearch ? { q: debouncedSearch } : {}),
	});
	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;
	const pageSize = query.data?.page_size ?? 25;

	const handleFilter = (next: ThumbFilter) => {
		setFilter(next);
		setPage(1);
	};

	const handleSearch = (next: string) => {
		setSearchInput(next);
		setPage(1);
	};

	return (
		<ChartCard
			title="Message reactions"
			description="Per-message thumbs feedback users have left on assistant replies."
		>
			<TableToolbar
				searchValue={searchInput}
				onSearchChange={handleSearch}
				searchPlaceholder="Search user, message, or thread…"
				filterPills={
					<FilterPills
						value={filter}
						onChange={handleFilter}
						options={THUMB_FILTERS}
					/>
				}
			/>

			{query.isPending ? (
				<TableSkeleton />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : items.length === 0 ? (
				<EmptyTable
					message={
						debouncedSearch
							? "No reactions match your search."
							: "No reactions in this range yet."
					}
				/>
			) : (
				<div className="flex flex-col gap-3">
					<ul className="flex flex-col divide-y divide-[var(--theme-border)]">
						{items.map((row) => (
							<MessageReactionRowItem key={row.message_id} row={row} />
						))}
					</ul>
					<TableFooter
						page={query.data?.page ?? page}
						total={total}
						pageSize={pageSize}
						items={items.length}
						onPageChange={setPage}
					/>
				</div>
			)}
		</ChartCard>
	);
}

function MessageReactionRowItem({ row }: { row: AdminMessageReactionRow }) {
	const isUp = row.rating === 1;
	const Icon = isUp ? ThumbsUp : ThumbsDown;
	return (
		<li>
			<Link
				to="/admin/activity/$threadId"
				params={{ threadId: row.thread_id }}
				className="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2.5 transition hover:bg-accent/40"
			>
				<span
					role="img"
					aria-label={isUp ? "Thumbs up" : "Thumbs down"}
					className={cn(
						"mt-0.5 inline-flex size-6 items-center justify-center rounded-full",
						isUp
							? "bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]"
							: "bg-[var(--theme-danger)]/10 text-[var(--theme-danger)]",
					)}
				>
					<Icon className="size-3.5" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<p className="m-0 truncate text-xs text-muted-foreground">
						{row.owner_email ?? row.owner_name ?? row.user_id}
						{row.thread_title ? <> · {row.thread_title}</> : null}
					</p>
					<p className="m-0 line-clamp-2 text-sm text-[var(--theme-primary)]">
						{row.message_preview}
					</p>
				</div>
				<div className="whitespace-nowrap text-xs text-muted-foreground">
					<CompactDate iso={row.rated_at} />
				</div>
			</Link>
		</li>
	);
}

// ---------------------------------------------------------------------------
// Shared toolbar / footer / states
// ---------------------------------------------------------------------------

function TableToolbar({
	searchValue,
	onSearchChange,
	searchPlaceholder,
	filterPills,
}: {
	searchValue: string;
	onSearchChange: (next: string) => void;
	searchPlaceholder: string;
	filterPills: React.ReactNode;
}) {
	return (
		<div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div className="relative w-full sm:max-w-xs">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					type="search"
					value={searchValue}
					onChange={(e) => onSearchChange(e.target.value)}
					placeholder={searchPlaceholder}
					aria-label={searchPlaceholder}
					className="h-9 pl-8 pr-8 text-sm"
				/>
				{searchValue ? (
					<button
						type="button"
						onClick={() => onSearchChange("")}
						aria-label="Clear search"
						className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition hover:text-[var(--theme-primary)]"
					>
						<X className="size-3.5" />
					</button>
				) : null}
			</div>
			{filterPills}
		</div>
	);
}

function FilterPills<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (next: T) => void;
	options: { value: T; label: string }[];
}) {
	return (
		<div className="flex w-fit items-center gap-1 rounded-md border border-[var(--theme-border)] bg-card p-0.5">
			{options.map((opt) => {
				const active = value === opt.value;
				return (
					<button
						key={opt.value}
						type="button"
						onClick={() => onChange(opt.value)}
						className={cn(
							"rounded-sm px-2.5 py-1 text-xs font-medium transition",
							active
								? "bg-[var(--theme-accent)] text-[var(--theme-on-accent)]"
								: "text-muted-foreground hover:text-[var(--theme-primary)]",
						)}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

function TableFooter({
	page,
	total,
	pageSize,
	items,
	onPageChange,
}: {
	page: number;
	total: number;
	pageSize: number;
	items: number;
	onPageChange: (page: number) => void;
}) {
	const start = (page - 1) * pageSize + 1;
	const end = (page - 1) * pageSize + items;
	return (
		<div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
			<span className="text-xs text-muted-foreground tabular-nums">
				Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
				{total.toLocaleString()}
			</span>
			<AdminPagination
				page={page}
				total={total}
				pageSize={pageSize}
				onChange={onPageChange}
			/>
		</div>
	);
}

function TableSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{Array.from({ length: 5 }, (_, i) => i).map((i) => (
				<Skeleton key={i} className="h-10 w-full" />
			))}
		</div>
	);
}

function EmptyTable({ message }: { message: string }) {
	return (
		<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
			{message}
		</div>
	);
}
