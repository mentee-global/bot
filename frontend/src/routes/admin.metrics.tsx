import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	LabelList,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Skeleton } from "#/components/ui/Skeleton";
import { ErrorState } from "#/features/admin/components/shared";
import type { MetricsParams } from "#/features/admin/data/admin.service";
import type {
	AdminMetricsCostPoint,
	AdminMetricsModelSlice,
	AdminMetricsPoint,
	AdminMetricsResponse,
	AdminMetricsRoleSlice,
	AdminMetricsTopUser,
} from "#/features/admin/data/admin.types";
import { useAdminMetricsQuery } from "#/features/admin/hooks/useAdmin";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const RANGE_OPTIONS = [1, 7, 30, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];
const DEFAULT_RANGE: RangeDays = 30;
const MAX_CUSTOM_RANGE_DAYS = 365;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type MetricsSearch = {
	days?: RangeDays;
	from?: string;
	to?: string;
};

function parseRange(raw: unknown): RangeDays | undefined {
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number.parseInt(raw, 10)
				: undefined;
	return RANGE_OPTIONS.includes(n as RangeDays) ? (n as RangeDays) : undefined;
}

function parseIsoDate(raw: unknown): string | undefined {
	if (typeof raw !== "string" || !ISO_DATE_RE.test(raw)) return undefined;
	const d = parseISO(raw);
	return Number.isNaN(d.getTime()) ? undefined : raw;
}

export const Route = createFileRoute("/admin/metrics")({
	component: MetricsRoute,
	validateSearch: (search: Record<string, unknown>): MetricsSearch => {
		const from = parseIsoDate(search.from);
		const to = parseIsoDate(search.to);
		// Only honor the custom range when both ends are present and ordered;
		// otherwise drop them so the URL doesn't carry a half-applied filter.
		if (from && to && from <= to) {
			return { from, to };
		}
		return { days: parseRange(search.days) };
	},
});

function MetricsRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate();

	const customRange =
		search.from && search.to ? { from: search.from, to: search.to } : null;
	const presetDays = customRange ? undefined : (search.days ?? DEFAULT_RANGE);
	const queryParams: MetricsParams = customRange
		? { from: customRange.from, to: customRange.to }
		: { days: presetDays };
	const metrics = useAdminMetricsQuery(queryParams);

	const data = metrics.data;
	const loading = metrics.isPending;

	const handlePreset = (next: RangeDays) =>
		navigate({
			to: "/admin/metrics",
			search: { days: next === DEFAULT_RANGE ? undefined : next },
			replace: true,
		});
	const handleCustom = (next: { from: string; to: string }) =>
		navigate({
			to: "/admin/metrics",
			search: { from: next.from, to: next.to },
			replace: true,
		});

	return (
		<section className="flex min-w-0 flex-col gap-6 sm:gap-8">
			<RangeFilter
				preset={presetDays}
				custom={customRange}
				onPreset={handlePreset}
				onCustom={handleCustom}
			/>

			{metrics.isError ? (
				<ErrorState
					error={metrics.error}
					onRetry={() => metrics.refetch()}
				/>
			) : (
				<>
					<KpiGrid data={data} loading={loading} />

					<MetricsSection title={m.admin_metrics_section_activity()}>
						<div className="grid min-w-0 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
							<ActivityChart
								data={data}
								loading={loading}
								className="lg:col-span-2"
							/>
							<UsersChart data={data} loading={loading} />
						</div>
						<HourOfDayChart data={data} loading={loading} />
					</MetricsSection>

					<MetricsSection title={m.admin_metrics_section_engagement()}>
						<div className="grid min-w-0 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
							<RoleSplitChart data={data} loading={loading} />
							<ThreadLengthChart data={data} loading={loading} />
							<TopUsersCard data={data} loading={loading} />
						</div>
					</MetricsSection>

					<MetricsSection title={m.admin_metrics_section_cost()}>
						<div className="grid min-w-0 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
							<CostChart
								data={data}
								loading={loading}
								className="lg:col-span-2"
							/>
							<ProviderMixChart data={data} loading={loading} />
						</div>
						<TokensChart data={data} loading={loading} />
					</MetricsSection>
				</>
			)}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function MetricsSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:text-sm">
				{title}
			</h2>
			<div className="flex min-w-0 flex-col gap-3 sm:gap-4">{children}</div>
		</div>
	);
}

function RangeFilter({
	preset,
	custom,
	onPreset,
	onCustom,
}: {
	preset: RangeDays | undefined;
	custom: { from: string; to: string } | null;
	onPreset: (next: RangeDays) => void;
	onCustom: (next: { from: string; to: string }) => void;
}) {
	const labels: Record<RangeDays, string> = {
		1: m.admin_metrics_range_today(),
		7: m.admin_metrics_range_7(),
		30: m.admin_metrics_range_30(),
		90: m.admin_metrics_range_90(),
	};
	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
			<div className="grid grid-cols-2 gap-1 rounded-md border bg-card p-0.5 sm:inline-flex sm:grid-cols-none sm:w-fit">
				{RANGE_OPTIONS.map((opt) => (
					<Button
						key={opt}
						type="button"
						size="sm"
						variant={preset === opt ? "default" : "ghost"}
						onClick={() => onPreset(opt)}
						className="h-8 px-3 text-xs"
					>
						{labels[opt]}
					</Button>
				))}
			</div>
			<CalendarPopover custom={custom} onCustom={onCustom} />
		</div>
	);
}

function CalendarPopover({
	custom,
	onCustom,
}: {
	custom: { from: string; to: string } | null;
	onCustom: (next: { from: string; to: string }) => void;
}) {
	const [open, setOpen] = useState(false);
	const initial = useMemo<DateRange | undefined>(() => {
		if (!custom) return undefined;
		return { from: parseISO(custom.from), to: parseISO(custom.to) };
	}, [custom]);
	const [draft, setDraft] = useState<DateRange | undefined>(initial);

	// Reset the draft when the popover opens — we want it to mirror the
	// currently-applied range, not a stale prior selection.
	const onOpenChange = (next: boolean) => {
		if (next) setDraft(initial);
		setOpen(next);
	};

	const today = new Date();
	const maxFrom = new Date(today);
	maxFrom.setDate(today.getDate() - (MAX_CUSTOM_RANGE_DAYS - 1));

	const canApply = Boolean(draft?.from && draft?.to);

	const apply = () => {
		if (!draft?.from || !draft?.to) return;
		onCustom({
			from: format(draft.from, "yyyy-MM-dd"),
			to: format(draft.to, "yyyy-MM-dd"),
		});
		setOpen(false);
	};

	const triggerLabel = custom
		? `${formatChipDate(custom.from)} – ${formatChipDate(custom.to)}`
		: m.admin_metrics_range_pick_dates();

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant={custom ? "default" : "outline"}
					size="sm"
					className={cn(
						"h-9 justify-start gap-2 text-xs sm:h-8",
						custom ? "" : "text-muted-foreground",
					)}
				>
					<CalendarIcon className="size-3.5 shrink-0" />
					<span className="truncate">{triggerLabel}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar
					mode="range"
					numberOfMonths={1}
					defaultMonth={draft?.from ?? today}
					selected={draft}
					onSelect={setDraft}
					disabled={{ before: maxFrom, after: today }}
				/>
				<div className="flex items-center justify-between gap-2 border-t p-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-8 text-xs"
						onClick={() => setDraft(undefined)}
					>
						{m.admin_metrics_range_clear()}
					</Button>
					<Button
						type="button"
						size="sm"
						className="h-8 text-xs"
						disabled={!canApply}
						onClick={apply}
					>
						{m.admin_metrics_range_apply()}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function formatChipDate(iso: string): string {
	const d = parseISO(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function KpiGrid({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const tokens =
		(data?.input_tokens_period ?? 0) + (data?.output_tokens_period ?? 0);
	const tiles: KpiTile[] = [
		{
			label: m.admin_metrics_kpi_new_users(),
			value: data?.new_users_period,
		},
		{
			label: m.admin_metrics_kpi_new_threads(),
			value: data?.new_threads_period,
		},
		{
			label: m.admin_metrics_kpi_new_messages(),
			value: data?.new_messages_period,
		},
		{
			label: m.admin_metrics_kpi_active_users(),
			value: data?.active_users_period,
		},
		{
			label: m.admin_metrics_kpi_avg_per_thread(),
			value: data?.avg_messages_per_thread,
			format: "decimal",
		},
		{
			label: m.admin_metrics_kpi_spend(),
			value: data ? data.cost_period_usd_micros : undefined,
			format: "usd_micros",
		},
		{
			label: m.admin_metrics_kpi_tokens(),
			value: data ? tokens : undefined,
			format: "compact",
		},
		{
			label: m.admin_metrics_kpi_requests(),
			value: data?.requests_period,
		},
	];

	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:grid-cols-8">
			{tiles.map((tile) => (
				<Card key={tile.label} className="gap-1 py-3 sm:gap-1.5 sm:py-4">
					<CardContent className="px-3 sm:px-4">
						<p className="m-0 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{tile.label}
						</p>
						<div className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl">
							{loading ? (
								<Skeleton className="h-5 w-12 sm:h-6" />
							) : (
								formatKpi(tile.value, tile.format)
							)}
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

type KpiFormat = "decimal" | "usd_micros" | "compact" | undefined;
type KpiTile = {
	label: string;
	value: number | undefined;
	format?: KpiFormat;
};

function formatKpi(value: number | undefined, mode: KpiFormat): string {
	if (value === undefined || value === null) return "—";
	if (mode === "decimal") return value.toFixed(2);
	if (mode === "usd_micros") return formatUsdMicros(value);
	if (mode === "compact") return formatCompact(value);
	return value.toLocaleString();
}

function formatUsdMicros(micros: number): string {
	const dollars = micros / 1_000_000;
	return dollars.toLocaleString(undefined, {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	});
}

function formatCompact(n: number): string {
	if (Math.abs(n) < 1000) return n.toLocaleString();
	return Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(n);
}

// ---------------------------------------------------------------------------
// Activity charts
// ---------------------------------------------------------------------------

const activityConfig = {
	messages: { label: "Messages", color: "var(--theme-accent)" },
	threads: { label: "Conversations", color: "var(--theme-primary)" },
} satisfies ChartConfig;

const usersConfig = {
	users: { label: "Users", color: "var(--theme-accent)" },
} satisfies ChartConfig;

function ActivityChart({
	data,
	loading,
	className,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
	className?: string;
}) {
	const config = useMemo(
		() => ({
			messages: {
				...activityConfig.messages,
				label: m.admin_metrics_messages_label(),
			},
			threads: {
				...activityConfig.threads,
				label: m.admin_metrics_threads_label(),
			},
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_activity_title()}
			description={m.admin_metrics_chart_activity_desc()}
			className={className}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : isEmptyDailySeries(data.series) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-60 w-full sm:h-72">
					<AreaChart data={data.series} margin={{ left: 8, right: 12 }}>
						<defs>
							<linearGradient id="fill-messages" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-messages)"
									stopOpacity={0.55}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-messages)"
									stopOpacity={0.05}
								/>
							</linearGradient>
							<linearGradient id="fill-threads" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-threads)"
									stopOpacity={0.45}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-threads)"
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
									labelFormatter={(value) =>
										typeof value === "string" ? longDate(value) : value
									}
									indicator="dot"
								/>
							}
						/>
						<Area
							dataKey="messages"
							type="natural"
							fill="url(#fill-messages)"
							stroke="var(--color-messages)"
							strokeWidth={2}
							stackId="a"
						/>
						<Area
							dataKey="threads"
							type="natural"
							fill="url(#fill-threads)"
							stroke="var(--color-threads)"
							strokeWidth={2}
							stackId="a"
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

function UsersChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const config = useMemo(
		() => ({
			users: { ...usersConfig.users, label: m.admin_metrics_users_label() },
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_users_title()}
			description={m.admin_metrics_chart_users_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : data.series.every((p) => p.users === 0) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-60 w-full sm:h-72">
					<AreaChart data={data.series} margin={{ left: 8, right: 12 }}>
						<defs>
							<linearGradient id="fill-users" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-users)"
									stopOpacity={0.55}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-users)"
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
									labelFormatter={(value) =>
										typeof value === "string" ? longDate(value) : value
									}
									indicator="dot"
								/>
							}
						/>
						<Area
							dataKey="users"
							type="natural"
							fill="url(#fill-users)"
							stroke="var(--color-users)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

function HourOfDayChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const config = useMemo(
		() => ({
			messages: {
				label: m.admin_metrics_messages_label(),
				color: "var(--theme-accent)",
			},
		}),
		[],
	);
	return (
		<ChartCard
			title={m.admin_metrics_chart_hour_title()}
			description={m.admin_metrics_chart_hour_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : data.hour_of_day.every((p) => p.messages === 0) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-56 w-full sm:h-64">
					<BarChart data={data.hour_of_day} margin={{ left: 8, right: 12 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="hour"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickFormatter={(h: number) => `${h}h`}
							interval={3}
							minTickGap={16}
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
									labelFormatter={(value) =>
										typeof value === "number" ? formatHourLabel(value) : value
									}
									indicator="dot"
								/>
							}
						/>
						<Bar
							dataKey="messages"
							fill="var(--color-messages)"
							radius={[4, 4, 0, 0]}
						/>
					</BarChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

// ---------------------------------------------------------------------------
// Engagement charts
// ---------------------------------------------------------------------------

const ROLE_COLORS = ["var(--theme-accent)", "var(--theme-primary)"] as const;

function RoleSplitChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const slices = useMemo(() => {
		if (!data) return [] as Array<AdminMetricsRoleSlice & { label: string }>;
		return data.role_breakdown.map((s) => ({
			...s,
			label:
				s.role === "user"
					? m.admin_metrics_role_user()
					: s.role === "assistant"
						? m.admin_metrics_role_assistant()
						: s.role,
		}));
	}, [data]);

	const total = slices.reduce((sum, s) => sum + s.messages, 0);
	const config: ChartConfig = useMemo(
		() => ({
			user: { label: m.admin_metrics_role_user(), color: ROLE_COLORS[0] },
			assistant: {
				label: m.admin_metrics_role_assistant(),
				color: ROLE_COLORS[1],
			},
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_role_title()}
			description={m.admin_metrics_chart_role_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : total === 0 ? (
				<EmptyChart />
			) : (
				<div className="flex flex-col gap-3">
					<ChartContainer
						config={config}
						className="mx-auto h-52 w-full sm:h-56"
					>
						<PieChart>
							<ChartTooltip
								content={
									<ChartTooltipContent
										hideLabel
										formatter={(value, _name, item) => {
											const payload = item.payload as
												| (AdminMetricsRoleSlice & { label?: string })
												| undefined;
											const label = payload?.label ?? payload?.role ?? "";
											const n = typeof value === "number" ? value : 0;
											const pct = total ? ((n / total) * 100).toFixed(0) : "0";
											return (
												<div className="flex w-full items-center justify-between gap-3">
													<span className="text-muted-foreground">{label}</span>
													<span className="font-mono font-medium tabular-nums">
														{n.toLocaleString()} · {pct}%
													</span>
												</div>
											);
										}}
									/>
								}
							/>
							<Pie
								data={slices}
								dataKey="messages"
								nameKey="role"
								innerRadius={60}
								outerRadius={90}
								paddingAngle={2}
							>
								{slices.map((s, i) => (
									<Cell
										key={s.role}
										fill={ROLE_COLORS[i % ROLE_COLORS.length]}
									/>
								))}
							</Pie>
						</PieChart>
					</ChartContainer>
					<div className="flex flex-wrap justify-center gap-3 text-xs">
						{slices.map((s, i) => (
							<div key={s.role} className="flex items-center gap-1.5">
								<span
									className="size-2.5 rounded-sm"
									style={{
										backgroundColor: ROLE_COLORS[i % ROLE_COLORS.length],
									}}
								/>
								<span className="text-muted-foreground">{s.label}</span>
								<span className="font-medium tabular-nums">
									{s.messages.toLocaleString()}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</ChartCard>
	);
}

function ThreadLengthChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const config: ChartConfig = useMemo(
		() => ({
			threads: {
				label: m.admin_metrics_threads_label_short(),
				color: "var(--theme-primary)",
			},
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_thread_length_title()}
			description={m.admin_metrics_chart_thread_length_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : data.thread_length_distribution.every((b) => b.threads === 0) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-52 w-full sm:h-56">
					<BarChart
						data={data.thread_length_distribution}
						margin={{ left: 8, right: 12, top: 12 }}
					>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="label"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
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
							content={<ChartTooltipContent indicator="dot" />}
						/>
						<Bar
							dataKey="threads"
							fill="var(--color-threads)"
							radius={[4, 4, 0, 0]}
						>
							<LabelList
								dataKey="threads"
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

function TopUsersCard({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	return (
		<ChartCard
			title={m.admin_metrics_chart_top_users_title()}
			description={m.admin_metrics_chart_top_users_desc()}
		>
			{loading || !data ? (
				<div className="flex flex-col gap-2">
					{Array.from({ length: 5 }, (_, i) => i).map((i) => (
						<Skeleton key={i} className="h-10 w-full" />
					))}
				</div>
			) : data.top_users.length === 0 ? (
				<div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
					{m.admin_metrics_top_users_empty()}
				</div>
			) : (
				<TopUsersList users={data.top_users} />
			)}
		</ChartCard>
	);
}

function TopUsersList({ users }: { users: AdminMetricsTopUser[] }) {
	const max = Math.max(1, ...users.map((u) => u.messages));
	return (
		<ul className="flex flex-col gap-2">
			{users.map((user) => (
				<li key={user.user_id}>
					<Link
						to="/admin/users/$userId"
						params={{ userId: user.user_id }}
						className="block rounded-lg border bg-card/40 px-3 py-2 transition hover:bg-accent/40"
					>
						<div className="flex items-center gap-3">
							<Avatar className="size-7">
								<AvatarFallback className="bg-[var(--theme-accent-soft)] text-[10px] text-[var(--theme-primary)]">
									{getInitials(user.name, user.email)}
								</AvatarFallback>
							</Avatar>
							<div className="min-w-0 flex-1">
								<p className="m-0 truncate text-sm font-medium">
									{user.name || user.email}
								</p>
								<p className="m-0 truncate text-xs text-muted-foreground">
									{user.email}
								</p>
							</div>
							<div className="flex flex-col items-end">
								<span className="font-mono text-sm font-semibold tabular-nums">
									{user.messages.toLocaleString()}
								</span>
								{user.role === "admin" ? (
									<Badge
										variant="secondary"
										className="h-4 px-1.5 text-[9px] uppercase"
									>
										admin
									</Badge>
								) : null}
							</div>
						</div>
						<div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-accent/40">
							<div
								className="h-full rounded-full bg-[var(--theme-accent)]"
								style={{ width: `${(user.messages / max) * 100}%` }}
							/>
						</div>
					</Link>
				</li>
			))}
		</ul>
	);
}

// ---------------------------------------------------------------------------
// Cost & usage charts
// ---------------------------------------------------------------------------

function CostChart({
	data,
	loading,
	className,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
	className?: string;
}) {
	const config: ChartConfig = useMemo(
		() => ({
			cost_usd: {
				label: m.admin_metrics_kpi_spend(),
				color: "var(--theme-accent)",
			},
		}),
		[],
	);

	const chartData = useMemo(
		() =>
			data
				? data.cost_series.map((p) => ({
						date: p.date,
						cost_usd: p.cost_usd_micros / 1_000_000,
					}))
				: [],
		[data],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_cost_title()}
			description={m.admin_metrics_chart_cost_desc()}
			className={className}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : isEmptyCostSeries(data.cost_series) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-60 w-full sm:h-72">
					<AreaChart data={chartData} margin={{ left: 8, right: 12 }}>
						<defs>
							<linearGradient id="fill-cost" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-cost_usd)"
									stopOpacity={0.6}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-cost_usd)"
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
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							width={48}
							tickFormatter={(n: number) =>
								n.toLocaleString(undefined, {
									style: "currency",
									currency: "USD",
									maximumFractionDigits: n < 1 ? 2 : 0,
								})
							}
						/>
						<ChartTooltip
							cursor={false}
							content={
								<ChartTooltipContent
									labelFormatter={(value) =>
										typeof value === "string" ? longDate(value) : value
									}
									formatter={(value) => {
										const n = typeof value === "number" ? value : 0;
										return (
											<span className="font-mono font-medium tabular-nums">
												{n.toLocaleString(undefined, {
													style: "currency",
													currency: "USD",
													maximumFractionDigits: 4,
												})}
											</span>
										);
									}}
									indicator="dot"
								/>
							}
						/>
						<Area
							dataKey="cost_usd"
							type="natural"
							fill="url(#fill-cost)"
							stroke="var(--color-cost_usd)"
							strokeWidth={2}
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

function TokensChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const config: ChartConfig = useMemo(
		() => ({
			input_tokens: {
				label: m.admin_metrics_input_tokens_label(),
				color: "var(--theme-primary)",
			},
			output_tokens: {
				label: m.admin_metrics_output_tokens_label(),
				color: "var(--theme-accent)",
			},
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_tokens_title()}
			description={m.admin_metrics_chart_tokens_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : isEmptyCostSeries(data.cost_series) ? (
				<EmptyChart />
			) : (
				<ChartContainer config={config} className="h-60 w-full sm:h-72">
					<AreaChart data={data.cost_series} margin={{ left: 8, right: 12 }}>
						<defs>
							<linearGradient id="fill-input" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-input_tokens)"
									stopOpacity={0.5}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-input_tokens)"
									stopOpacity={0.05}
								/>
							</linearGradient>
							<linearGradient id="fill-output" x1="0" y1="0" x2="0" y2="1">
								<stop
									offset="5%"
									stopColor="var(--color-output_tokens)"
									stopOpacity={0.55}
								/>
								<stop
									offset="95%"
									stopColor="var(--color-output_tokens)"
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
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							width={44}
							tickFormatter={(n: number) => formatCompact(n)}
							allowDecimals={false}
						/>
						<ChartTooltip
							cursor={false}
							content={
								<ChartTooltipContent
									labelFormatter={(value) =>
										typeof value === "string" ? longDate(value) : value
									}
									indicator="dot"
								/>
							}
						/>
						<Area
							dataKey="input_tokens"
							type="natural"
							fill="url(#fill-input)"
							stroke="var(--color-input_tokens)"
							strokeWidth={2}
							stackId="t"
						/>
						<Area
							dataKey="output_tokens"
							type="natural"
							fill="url(#fill-output)"
							stroke="var(--color-output_tokens)"
							strokeWidth={2}
							stackId="t"
						/>
					</AreaChart>
				</ChartContainer>
			)}
		</ChartCard>
	);
}

const PROVIDER_COLORS = [
	"var(--theme-accent)",
	"var(--theme-primary)",
	"var(--theme-accent-soft, var(--theme-accent))",
] as const;

function ProviderMixChart({
	data,
	loading,
}: {
	data: AdminMetricsResponse | undefined;
	loading: boolean;
}) {
	const slices = useMemo(() => {
		if (!data) return [] as Array<AdminMetricsModelSlice & { label: string }>;
		return data.model_breakdown.map((s) => ({
			...s,
			label: providerLabel(s.model),
		}));
	}, [data]);

	const totalCost = slices.reduce((sum, s) => sum + s.cost_usd_micros, 0);
	const config: ChartConfig = useMemo(
		() => ({
			cost: { label: m.admin_metrics_kpi_spend() },
		}),
		[],
	);

	return (
		<ChartCard
			title={m.admin_metrics_chart_model_title()}
			description={m.admin_metrics_chart_model_desc()}
		>
			{loading || !data ? (
				<ChartSkeleton />
			) : totalCost === 0 ? (
				<EmptyChart />
			) : (
				<div className="flex flex-col gap-3">
					<ChartContainer
						config={config}
						className="mx-auto h-52 w-full sm:h-56"
					>
						<PieChart>
							<ChartTooltip
								content={
									<ChartTooltipContent
										hideLabel
										formatter={(value, _name, item) => {
											const payload = item.payload as
												| (AdminMetricsModelSlice & { label?: string })
												| undefined;
											const label = payload?.label ?? payload?.model ?? "";
											const n = typeof value === "number" ? value : 0;
											const pct = totalCost
												? ((n / totalCost) * 100).toFixed(0)
												: "0";
											return (
												<div className="flex w-full items-center justify-between gap-3">
													<span className="text-muted-foreground">{label}</span>
													<span className="font-mono font-medium tabular-nums">
														{formatUsdMicros(n)} · {pct}%
													</span>
												</div>
											);
										}}
									/>
								}
							/>
							<Pie
								data={slices}
								dataKey="cost_usd_micros"
								nameKey="model"
								innerRadius={50}
								outerRadius={85}
								paddingAngle={2}
							>
								{slices.map((s, i) => (
									<Cell
										key={s.model}
										fill={PROVIDER_COLORS[i % PROVIDER_COLORS.length]}
									/>
								))}
							</Pie>
						</PieChart>
					</ChartContainer>
					<ul className="flex flex-col gap-1.5 text-xs">
						{slices.map((s, i) => (
							<li
								key={s.model}
								className="flex items-center justify-between gap-2"
							>
								<span className="flex items-center gap-1.5 truncate">
									<span
										className="size-2.5 shrink-0 rounded-sm"
										style={{
											backgroundColor:
												PROVIDER_COLORS[i % PROVIDER_COLORS.length],
										}}
									/>
									<span className="truncate text-muted-foreground">
										{s.label}
									</span>
								</span>
								<span className="font-mono font-medium tabular-nums">
									{formatUsdMicros(s.cost_usd_micros)}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</ChartCard>
	);
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function ChartCard({
	title,
	description,
	className,
	children,
}: {
	title: string;
	description: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<Card className={cn("min-w-0 gap-2 py-4 sm:py-6", className)}>
			<CardHeader className="px-4 sm:px-6">
				<CardTitle className="text-base sm:text-lg">{title}</CardTitle>
				<p className="text-xs text-muted-foreground sm:text-sm">
					{description}
				</p>
			</CardHeader>
			<CardContent className="min-w-0 px-2 sm:px-6">{children}</CardContent>
		</Card>
	);
}

function isEmptyDailySeries(series: AdminMetricsPoint[]): boolean {
	return series.every(
		(p) => p.users === 0 && p.threads === 0 && p.messages === 0,
	);
}

function isEmptyCostSeries(series: AdminMetricsCostPoint[]): boolean {
	return series.every(
		(p) =>
			p.cost_usd_micros === 0 &&
			p.input_tokens === 0 &&
			p.output_tokens === 0 &&
			p.requests === 0,
	);
}

function shortDate(value: string): string {
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longDate(value: string): string {
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatHourLabel(hour: number): string {
	const next = (hour + 1) % 24;
	return `${hour.toString().padStart(2, "0")}:00 – ${next
		.toString()
		.padStart(2, "0")}:00 UTC`;
}

function providerLabel(model: string): string {
	if (model === "openai") return m.admin_metrics_provider_openai();
	if (model === "perplexity") return m.admin_metrics_provider_perplexity();
	if (model === "web_search") return m.admin_metrics_provider_web_search();
	return model;
}

function getInitials(name: string | undefined, email: string): string {
	const source = (name?.trim() || email || "??").trim();
	const parts = source.split(/[\s@.]+/).filter(Boolean);
	const first = parts[0]?.[0] ?? "?";
	const second = parts[1]?.[0] ?? "";
	return (first + second).toUpperCase();
}

function ChartSkeleton() {
	return <Skeleton className="h-60 w-full sm:h-72" />;
}

function EmptyChart() {
	return (
		<div className="flex h-44 items-center justify-center px-4 text-center text-xs text-muted-foreground sm:h-56 sm:text-sm">
			{m.admin_metrics_empty()}
		</div>
	);
}
