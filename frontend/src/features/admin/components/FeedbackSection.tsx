import { Link } from "@tanstack/react-router";
import {
	MessageSquareText,
	Search,
	ThumbsDown,
	ThumbsUp,
	X,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Slider } from "#/components/ui/slider";
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
import type { CommentFilter, ThumbsFilter } from "#/routes/admin.feedback";

// ---------------------------------------------------------------------------
// Overview — KPIs + the two summary charts. Lives on its own section so
// admins can deep-link to /admin/feedback?section=overview without having
// to render either of the (potentially heavy) detail tables.
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
// Session ratings
// ---------------------------------------------------------------------------
//
// All filter/page/q state lives in the URL; the parent route owns it and
// passes it in. We keep the search input in local state so the debounce
// hook has a stable source — driving it from `q` directly would skip the
// debounce.
// ---------------------------------------------------------------------------

const COMMENT_OPTIONS: { value: CommentFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "yes", label: "With comment" },
	{ value: "no", label: "No comment" },
];

function commentToParam(filter: CommentFilter): boolean | undefined {
	if (filter === "yes") return true;
	if (filter === "no") return false;
	return undefined;
}

export type SessionRatingsState = {
	page?: number;
	q?: string;
	min?: number;
	max?: number;
	comments?: CommentFilter;
};

export function SessionRatingsTable({
	page,
	q,
	min,
	max,
	comments,
	onChange,
}: {
	page: number;
	q: string;
	min: number;
	max: number;
	comments: CommentFilter;
	onChange: (next: SessionRatingsState) => void;
}) {
	const [searchInput, setSearchInput] = useState(q);

	useEffect(() => {
		setSearchInput(q);
	}, [q]);

	const debouncedSearch = useDebouncedValue(searchInput.trim(), 250);

	// Publish the debounced value back into the URL once the user stops
	// typing. Only `debouncedSearch` and `q` are real triggers — the early
	// return guards against double-fires when q is already in sync, and
	// excluding `onChange`/filter values keeps the effect from looping on
	// every parent re-render (the parent recreates its handlers each render).
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		const next = debouncedSearch || undefined;
		if (next === (q || undefined)) return;
		onChange({
			page: undefined,
			q: next,
			min,
			max,
			comments,
		});
	}, [debouncedSearch, q]);

	const query = useAdminRatingsQuery({
		page,
		...(min > 1 ? { min_stars: min } : {}),
		...(max < 5 ? { max_stars: max } : {}),
		...(commentToParam(comments) !== undefined
			? { has_comment: commentToParam(comments) }
			: {}),
		...(debouncedSearch ? { q: debouncedSearch } : {}),
	});
	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;
	const pageSize = query.data?.page_size ?? 25;

	const setPage = (next: number) =>
		onChange({ page: next > 1 ? next : undefined, q, min, max, comments });
	const setRange = (next: [number, number]) =>
		onChange({
			page: undefined,
			q,
			min: next[0] > 1 ? next[0] : undefined,
			max: next[1] < 5 ? next[1] : undefined,
			comments,
		});
	const setComments = (next: CommentFilter) =>
		onChange({
			page: undefined,
			q,
			min,
			max,
			comments: next === "all" ? undefined : next,
		});

	const filtersActive =
		min > 1 || max < 5 || comments !== "all" || debouncedSearch.length > 0;

	const clearFilters = () => {
		setSearchInput("");
		onChange({
			page: undefined,
			q: undefined,
			min: undefined,
			max: undefined,
			comments: undefined,
		});
	};

	return (
		<ChartCard
			title="Session ratings"
			description="Every 1–5 star rating users have left. Click a row to open the conversation."
		>
			<RatingsToolbar
				searchValue={searchInput}
				onSearchChange={setSearchInput}
				min={min}
				max={max}
				onRangeChange={setRange}
				comments={comments}
				onCommentsChange={setComments}
				filtersActive={filtersActive}
				onClear={clearFilters}
			/>

			{query.isPending ? (
				<TableSkeleton />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : items.length === 0 ? (
				<EmptyTable
					message={
						filtersActive
							? "No ratings match your filters."
							: "No ratings have been submitted yet."
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
					<p className="m-0 flex items-center gap-1.5 truncate text-sm font-medium">
						<span className="truncate">
							{row.title || "(untitled conversation)"}
						</span>
						{row.comment ? (
							<MessageSquareText
								className="size-3 shrink-0 text-muted-foreground"
								aria-label="Has comment"
							/>
						) : null}
					</p>
					<p className="m-0 truncate text-xs text-muted-foreground">
						{row.owner_email ?? row.owner_name ?? row.user_id}
						{row.comment ? <> · &ldquo;{row.comment}&rdquo;</> : null}
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
// Ratings toolbar — search + dual-thumb star slider + comment filter
// ---------------------------------------------------------------------------

function RatingsToolbar({
	searchValue,
	onSearchChange,
	min,
	max,
	onRangeChange,
	comments,
	onCommentsChange,
	filtersActive,
	onClear,
}: {
	searchValue: string;
	onSearchChange: (next: string) => void;
	min: number;
	max: number;
	onRangeChange: (next: [number, number]) => void;
	comments: CommentFilter;
	onCommentsChange: (next: CommentFilter) => void;
	filtersActive: boolean;
	onClear: () => void;
}) {
	return (
		<div className="mb-3 flex min-w-0 flex-col gap-3">
			<div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
				<SearchField
					value={searchValue}
					onChange={onSearchChange}
					placeholder="Search user, title, or comment…"
					className="min-w-0 flex-1 lg:max-w-sm"
				/>
				<StarRangeSlider min={min} max={max} onChange={onRangeChange} />
				<div className="flex items-center gap-2">
					<FilterSelect
						label="Comments"
						ariaLabel="Filter by comment presence"
						value={comments}
						onChange={onCommentsChange}
						options={COMMENT_OPTIONS}
					/>
					{filtersActive ? <ClearButton onClick={onClear} /> : null}
				</div>
			</div>
		</div>
	);
}

function StarRangeSlider({
	min,
	max,
	onChange,
}: {
	min: number;
	max: number;
	onChange: (next: [number, number]) => void;
}) {
	const sliderId = useId();
	// Local mirror of the slider value so the thumbs animate smoothly while
	// the user drags. We commit to the URL on `onValueCommit` to avoid a
	// network round-trip per pixel.
	const [pending, setPending] = useState<[number, number]>([min, max]);

	useEffect(() => {
		setPending([min, max]);
	}, [min, max]);

	const isAll = pending[0] === 1 && pending[1] === 5;
	const summary = isAll
		? "All stars"
		: pending[0] === pending[1]
			? `${pending[0]}★ only`
			: `${pending[0]}–${pending[1]}★`;

	return (
		<div className="flex min-w-0 flex-col gap-1 lg:w-64">
			<div className="flex items-center justify-between gap-2">
				<label
					htmlFor={sliderId}
					className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
				>
					Stars
				</label>
				<span className="font-mono text-xs text-muted-foreground tabular-nums">
					{summary}
				</span>
			</div>
			<div className="relative flex h-9 items-center px-1.5">
				<Slider
					id={sliderId}
					aria-label="Star rating range"
					min={1}
					max={5}
					step={1}
					value={pending}
					minStepsBetweenThumbs={0}
					onValueChange={(v) => setPending([v[0] ?? 1, v[1] ?? 5])}
					onValueCommit={(v) => onChange([v[0] ?? 1, v[1] ?? 5])}
				/>
			</div>
			<div className="-mt-0.5 flex justify-between px-1.5 text-[10px] text-muted-foreground tabular-nums">
				{[1, 2, 3, 4, 5].map((n) => {
					const inRange = n >= pending[0] && n <= pending[1];
					return (
						<button
							key={n}
							type="button"
							onClick={() => {
								setPending([n, n]);
								onChange([n, n]);
							}}
							aria-label={`Show ${n}-star ratings only`}
							className={cn(
								"rounded px-0.5 transition hover:text-[var(--theme-primary)]",
								inRange ? "font-medium text-[var(--theme-primary)]" : "",
							)}
						>
							{n}★
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Message reactions
// ---------------------------------------------------------------------------

function thumbsToParam(filter: ThumbsFilter): -1 | 1 | undefined {
	if (filter === "up") return 1;
	if (filter === "down") return -1;
	return undefined;
}

export type MessageReactionsState = {
	page?: number;
	q?: string;
	rating?: ThumbsFilter;
};

export function MessageReactionsTable({
	page,
	q,
	rating,
	onChange,
}: {
	page: number;
	q: string;
	rating: ThumbsFilter;
	onChange: (next: MessageReactionsState) => void;
}) {
	const [searchInput, setSearchInput] = useState(q);

	useEffect(() => {
		setSearchInput(q);
	}, [q]);

	const debouncedSearch = useDebouncedValue(searchInput.trim(), 250);

	// See SessionRatingsTable for the rationale on the dep list.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
	useEffect(() => {
		const next = debouncedSearch || undefined;
		if (next === (q || undefined)) return;
		onChange({ page: undefined, q: next, rating });
	}, [debouncedSearch, q]);

	const ratingParam = thumbsToParam(rating);
	const query = useAdminMessageReactionsQuery({
		page,
		...(ratingParam !== undefined ? { rating: ratingParam } : {}),
		...(debouncedSearch ? { q: debouncedSearch } : {}),
	});
	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;
	const pageSize = query.data?.page_size ?? 25;

	const setPage = (next: number) =>
		onChange({ page: next > 1 ? next : undefined, q, rating });
	const setRating = (next: ThumbsFilter) =>
		onChange({
			page: undefined,
			q,
			rating: next === "all" ? undefined : next,
		});

	const filtersActive = rating !== "all" || debouncedSearch.length > 0;

	const clearFilters = () => {
		setSearchInput("");
		onChange({ page: undefined, q: undefined, rating: undefined });
	};

	return (
		<ChartCard
			title="Message reactions"
			description="Per-message thumbs feedback users have left on assistant replies."
		>
			<ReactionsToolbar
				searchValue={searchInput}
				onSearchChange={setSearchInput}
				rating={rating}
				onRatingChange={setRating}
				filtersActive={filtersActive}
				onClear={clearFilters}
			/>

			{query.isPending ? (
				<TableSkeleton />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : items.length === 0 ? (
				<EmptyTable
					message={
						filtersActive
							? "No reactions match your filters."
							: "No reactions have been submitted yet."
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
// Reactions toolbar — search + segmented thumbs filter
// ---------------------------------------------------------------------------

function ReactionsToolbar({
	searchValue,
	onSearchChange,
	rating,
	onRatingChange,
	filtersActive,
	onClear,
}: {
	searchValue: string;
	onSearchChange: (next: string) => void;
	rating: ThumbsFilter;
	onRatingChange: (next: ThumbsFilter) => void;
	filtersActive: boolean;
	onClear: () => void;
}) {
	return (
		<div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
			<SearchField
				value={searchValue}
				onChange={onSearchChange}
				placeholder="Search user, message, or thread…"
				className="min-w-0 flex-1 sm:max-w-sm"
			/>
			<div className="flex items-center gap-2">
				<ThumbsSegmented value={rating} onChange={onRatingChange} />
				{filtersActive ? <ClearButton onClick={onClear} /> : null}
			</div>
		</div>
	);
}

function ThumbsSegmented({
	value,
	onChange,
}: {
	value: ThumbsFilter;
	onChange: (next: ThumbsFilter) => void;
}) {
	const buttons: {
		value: ThumbsFilter;
		label: string;
		icon?: typeof ThumbsUp;
	}[] = [
		{ value: "all", label: "All" },
		{ value: "up", label: "Up", icon: ThumbsUp },
		{ value: "down", label: "Down", icon: ThumbsDown },
	];
	return (
		<fieldset
			aria-label="Filter by reaction"
			className="inline-flex h-9 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] p-0.5 text-xs"
		>
			{buttons.map((b) => {
				const active = value === b.value;
				const Icon = b.icon;
				return (
					<button
						key={b.value}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(b.value)}
						className={cn(
							"inline-flex items-center gap-1 rounded-sm px-2.5 transition",
							active
								? "bg-[var(--theme-accent)] text-[var(--theme-on-accent)]"
								: "text-muted-foreground hover:text-[var(--theme-primary)]",
						)}
					>
						{Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
						{b.label}
					</button>
				);
			})}
		</fieldset>
	);
}

// ---------------------------------------------------------------------------
// Shared bits — search input, select wrapper, clear button, footer, states
// ---------------------------------------------------------------------------

function SearchField({
	value,
	onChange,
	placeholder,
	className,
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	className?: string;
}) {
	return (
		<div className={cn("relative", className)}>
			<Search
				className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				// Use type="text" rather than "search" so the browser doesn't
				// render its own clear-X overlapping ours. Style still reads as a
				// search affordance via the leading icon.
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				aria-label={placeholder}
				className="h-9 w-full pl-8 pr-8 text-sm"
			/>
			{value ? (
				<button
					type="button"
					onClick={() => onChange("")}
					aria-label="Clear search"
					className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition hover:text-[var(--theme-primary)]"
				>
					<X className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

function FilterSelect<T extends string>({
	label,
	ariaLabel,
	value,
	onChange,
	options,
}: {
	label: string;
	ariaLabel: string;
	value: T;
	onChange: (next: T) => void;
	options: { value: T; label: string }[];
}) {
	const id = useId();
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<label
				htmlFor={id}
				className="hidden text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline"
			>
				{label}
			</label>
			<Select value={value} onValueChange={(v) => onChange(v as T)}>
				<SelectTrigger
					id={id}
					aria-label={ariaLabel}
					className="h-9 min-w-[7.5rem] text-xs"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((opt) => (
						<SelectItem key={opt.value} value={opt.value}>
							{opt.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function ClearButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-[var(--theme-border)] px-2.5 text-xs text-muted-foreground transition hover:text-[var(--theme-primary)]"
		>
			<X className="size-3" /> Clear
		</button>
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
		<div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
			{message}
		</div>
	);
}
