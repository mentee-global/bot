import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { ErrorState, LoadingState } from "#/features/admin/components/shared";
import { Field } from "#/features/budget/components/Field";
import { ProvidersCard } from "#/features/budget/components/ProvidersCard";
import { SpendBar } from "#/features/budget/components/SpendBar";
import type { BudgetConfigPatchWithReason } from "#/features/budget/data/budget.service";
import type {
	BudgetConfig,
	BudgetConfigChange,
	BudgetConfigPatch,
	GlobalSpend,
} from "#/features/budget/data/budget.types";
import {
	useBudgetConfigHistoryQuery,
	useBudgetConfigQuery,
	useBudgetStateQuery,
	useUpdateConfigMutation,
	useUpdateFlagsMutation,
} from "#/features/budget/hooks/useBudget";
import { formatMicros } from "#/features/budget/lib/format";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/admin/budget")({
	component: BudgetRoute,
});

// ---------------------------------------------------------------------------
// Shared config metadata. Declared up front so the history table can render
// friendly labels + money formatting without re-checking field names.
// ---------------------------------------------------------------------------

type FieldKind = "credits_int" | "credits_usd" | "pricing_usd";

interface FieldMeta {
	label: string;
	kind: FieldKind;
}

const FIELD_META: Record<string, FieldMeta> = {
	default_monthly_credits: {
		label: "Default monthly credits",
		kind: "credits_int",
	},
	credit_usd_value_micros: {
		label: "Credit → USD value",
		kind: "credits_usd",
	},
	pricing_openai_input_per_mtok_micros: {
		label: "OpenAI input / 1M tokens",
		kind: "pricing_usd",
	},
	pricing_openai_output_per_mtok_micros: {
		label: "OpenAI output / 1M tokens",
		kind: "pricing_usd",
	},
	pricing_perplexity_input_per_mtok_micros: {
		label: "Perplexity input / 1M tokens",
		kind: "pricing_usd",
	},
	pricing_perplexity_output_per_mtok_micros: {
		label: "Perplexity output / 1M tokens",
		kind: "pricing_usd",
	},
	pricing_perplexity_request_fee_micros: {
		label: "Perplexity request fee / call",
		kind: "pricing_usd",
	},
	pricing_web_search_per_call_micros: {
		label: "Web search fee / call",
		kind: "pricing_usd",
	},
};

const CREDITS_FIELDS = new Set([
	"default_monthly_credits",
	"credit_usd_value_micros",
]);

const PRICING_FIELDS = new Set(
	Object.keys(FIELD_META).filter((k) => k.startsWith("pricing_")),
);

function formatFieldValue(field: string, value: number | null): string {
	if (value == null) return "—";
	const meta = FIELD_META[field];
	if (!meta) return String(value);
	if (meta.kind === "credits_int") return String(value);
	// Both credits_usd and pricing_usd are micros. Pricing rates go to 4dp so
	// sub-cent provider rates (e.g. $0.0075) don't round to zero.
	return formatMicros(value, {
		precision: meta.kind === "pricing_usd" ? 4 : 2,
	});
}

// ---------------------------------------------------------------------------

function BudgetRoute() {
	return (
		<Tabs
			defaultValue="overview"
			className="flex h-full min-h-0 flex-col gap-4"
		>
			<TabsList className="shrink-0 self-start">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="credits">Credits</TabsTrigger>
				<TabsTrigger value="pricing">Pricing</TabsTrigger>
				<TabsTrigger value="controls">Controls</TabsTrigger>
			</TabsList>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<TabsContent value="overview">
					<OverviewTab />
				</TabsContent>
				<TabsContent value="credits">
					<CreditsTab />
				</TabsContent>
				<TabsContent value="pricing">
					<PricingTab />
				</TabsContent>
				<TabsContent value="controls">
					<ControlsTab />
				</TabsContent>
			</div>
		</Tabs>
	);
}

// ---------------------------------------------------------------------------
// Overview — estimated spend + flag-reason banner + flag status
// ---------------------------------------------------------------------------

function OverviewTab() {
	const state = useBudgetStateQuery();

	if (state.isPending) return <LoadingState />;
	if (state.isError) return <ErrorState message={state.error.message} />;
	const s = state.data;
	if (!s) return null;

	const periodLabel = new Date(s.period_start).toLocaleString(undefined, {
		month: "long",
		year: "numeric",
	});

	return (
		<section className="flex flex-col gap-5">
			<Card>
				<CardContent className="flex flex-col gap-2">
					<p className="island-kicker m-0">Period</p>
					<h2 className="m-0 text-lg font-semibold">{periodLabel}</h2>
					<p className="m-0 text-sm text-muted-foreground">
						Bot-ledger spend{" "}
						<span className="font-semibold text-foreground">
							{formatMicros(s.total_spend_micros)}
						</span>{" "}
						so far this period. This number is{" "}
						<em>estimated from token counts × configured pricing</em> — it's not
						a real provider balance. Authoritative billing comes from Providers
						below; the kill-switches flip automatically when a provider returns
						an insufficient-funds error.
					</p>
				</CardContent>
			</Card>

			<FlagReasonBanner state={s} />

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						Bot ledger (estimate)
					</h3>
					<p className="m-0 text-[11px] text-muted-foreground">
						What this bot thinks it spent — not a real balance.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="OpenAI"
								spentMicros={s.openai_spend_micros}
								stopped={s.hard_stopped}
							/>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="Perplexity"
								spentMicros={s.perplexity_spend_micros}
								warn={s.perplexity_degraded}
							/>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="Web search (OpenAI builtin)"
								spentMicros={s.web_search_spend_micros}
							/>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="Total"
								spentMicros={s.total_spend_micros}
								stopped={s.hard_stopped}
							/>
						</CardContent>
					</Card>
				</div>
			</div>

			<ProvidersCard />

			<Card>
				<CardContent>
					<dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<FlagRow
							label="Perplexity degraded"
							active={s.perplexity_degraded}
							hint="Users can still chat; Sonar searches are disabled until this clears."
						/>
						<FlagRow
							label="Hard stopped"
							active={s.hard_stopped}
							hint="All chat is paused until the flag is cleared or the provider balance is topped up."
						/>
					</dl>
				</CardContent>
			</Card>
		</section>
	);
}

function FlagReasonBanner({ state }: { state: GlobalSpend }) {
	if (!state.hard_stopped && !state.perplexity_degraded) return null;
	return (
		<div className="flex flex-col gap-3">
			{state.hard_stopped ? (
				<ReasonCard
					severity="danger"
					title="Chat is paused"
					reason={state.hard_stop_reason}
					at={state.hard_stopped_at}
				/>
			) : null}
			{state.perplexity_degraded ? (
				<ReasonCard
					severity="warn"
					title="Sonar (Perplexity) is disabled"
					reason={state.perplexity_degrade_reason}
					at={state.perplexity_degraded_at}
				/>
			) : null}
		</div>
	);
}

function ReasonCard({
	severity,
	title,
	reason,
	at,
}: {
	severity: "warn" | "danger";
	title: string;
	reason: string | null;
	at: string | null;
}) {
	const color =
		severity === "danger"
			? "var(--theme-danger)"
			: "var(--theme-warning,theme(colors.amber.500))";
	const when = at
		? new Date(at).toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			})
		: null;
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<span
						className="inline-block h-2.5 w-2.5 rounded-full"
						style={{ background: color }}
					/>
					<h3 className="m-0 text-sm font-semibold">{title}</h3>
				</div>
				<p className="m-0 text-sm text-muted-foreground">
					{reason ?? "No reason recorded."}
				</p>
				{when ? (
					<p className="m-0 text-[11px] text-muted-foreground">
						Triggered {when}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function FlagRow({
	label,
	active,
	hint,
}: {
	label: string;
	active: boolean;
	hint: string;
}) {
	return (
		<div>
			<dt className="m-0 flex items-center gap-2 text-sm font-medium">
				<span
					className={`inline-block h-2 w-2 rounded-full ${
						active ? "bg-[var(--theme-danger)]" : "bg-[var(--theme-accent)]"
					}`}
				/>
				{label}
				<span className="ml-1 text-xs font-normal text-muted-foreground">
					{active ? "active" : "idle"}
				</span>
			</dt>
			<dd className="m-0 mt-1 text-xs text-muted-foreground">{hint}</dd>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Credits — per-user defaults + credit-to-USD value. Reason required.
// ---------------------------------------------------------------------------

function CreditsTab() {
	const cfg = useBudgetConfigQuery();
	const update = useUpdateConfigMutation();
	const [draft, setDraft] = useState<BudgetConfigPatch>({});
	const [reason, setReason] = useState("");
	const [flash, setFlash] = useState<string | null>(null);

	useEffect(() => {
		if (!update.isSuccess) return;
		setFlash("Saved.");
		setDraft({});
		setReason("");
		const t = setTimeout(() => setFlash(null), 2200);
		return () => clearTimeout(t);
	}, [update.isSuccess]);

	if (cfg.isPending) return <LoadingState />;
	if (cfg.isError) return <ErrorState message={cfg.error.message} />;
	const c = cfg.data;
	if (!c) return null;

	const val = <K extends keyof BudgetConfigPatch>(key: K) =>
		draft[key] ?? c[key as keyof BudgetConfig];
	const set = <K extends keyof BudgetConfigPatch>(
		key: K,
		next: BudgetConfigPatch[K],
	) => setDraft((d) => ({ ...d, [key]: next }));

	const trimmedReason = reason.trim();
	const reasonValid = trimmedReason.length >= 5;
	const hasChanges = Object.keys(draft).length > 0;
	const canSubmit = hasChanges && reasonValid && !update.isPending;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (!canSubmit) return;
				const payload: BudgetConfigPatchWithReason = {
					reason: trimmedReason,
					...Object.fromEntries(
						Object.entries(draft).filter(([, v]) => v !== undefined),
					),
				};
				update.mutate(payload);
			}}
			className="flex flex-col gap-5"
		>
			<Card>
				<CardContent className="flex flex-col gap-4">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						Per-user defaults
					</h3>
					<IntField
						label="Default monthly credits (per user)"
						hint="New users and monthly resets start with this number."
						value={val("default_monthly_credits") as number}
						onChange={(n) => set("default_monthly_credits", n)}
					/>
					<UsdField
						label="Credit → USD value"
						hint="One credit ≈ this many US dollars. Smaller = credits deplete faster."
						micros={val("credit_usd_value_micros") as number}
						onChange={(n) => set("credit_usd_value_micros", n)}
					/>
				</CardContent>
			</Card>

			<ReasonField
				value={reason}
				onChange={setReason}
				hasChanges={hasChanges}
				helpText="Why are you changing the credit defaults? Be specific — a future admin looking at the audit log should understand the decision without asking you."
			/>

			<SaveRow
				submitting={update.isPending}
				disabled={!canSubmit}
				flash={flash}
				error={update.isError ? update.error.message : null}
			/>

			<ChangeHistoryCard
				title="Recent Credits changes"
				fieldFilter={(f) => CREDITS_FIELDS.has(f)}
			/>
		</form>
	);
}

// ---------------------------------------------------------------------------
// Pricing — per-model rates. Banners explain why to think twice + why we
// can't auto-pull these from the provider.
// ---------------------------------------------------------------------------

function PricingTab() {
	const cfg = useBudgetConfigQuery();
	const update = useUpdateConfigMutation();
	const [draft, setDraft] = useState<BudgetConfigPatch>({});
	const [reason, setReason] = useState("");
	const [flash, setFlash] = useState<string | null>(null);

	useEffect(() => {
		if (!update.isSuccess) return;
		setFlash("Saved.");
		setDraft({});
		setReason("");
		const t = setTimeout(() => setFlash(null), 2200);
		return () => clearTimeout(t);
	}, [update.isSuccess]);

	if (cfg.isPending) return <LoadingState />;
	if (cfg.isError) return <ErrorState message={cfg.error.message} />;
	const c = cfg.data;
	if (!c) return null;

	const v = <K extends keyof BudgetConfigPatch>(key: K) =>
		draft[key] ?? c[key as keyof BudgetConfig];
	const s = <K extends keyof BudgetConfigPatch>(
		key: K,
		next: BudgetConfigPatch[K],
	) => setDraft((d) => ({ ...d, [key]: next }));

	const trimmedReason = reason.trim();
	const reasonValid = trimmedReason.length >= 5;
	const hasChanges = Object.keys(draft).length > 0;
	const canSubmit = hasChanges && reasonValid && !update.isPending;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (!canSubmit) return;
				const payload: BudgetConfigPatchWithReason = {
					reason: trimmedReason,
					...Object.fromEntries(
						Object.entries(draft).filter(([, val]) => val !== undefined),
					),
				};
				update.mutate(payload);
			}}
			className="flex flex-col gap-5"
		>
			<PricingIntroBanner />

			<Card>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							OpenAI
						</h3>
						<p className="m-0 text-xs text-muted-foreground">
							Verify the current rates for the exact model we run (check
							Overview → Provider column for the live model) before editing.{" "}
							<a
								className="underline underline-offset-2"
								href="https://openai.com/api/pricing/"
								target="_blank"
								rel="noreferrer"
							>
								OpenAI pricing page →
							</a>
						</p>
					</div>
					<UsdField
						label="Input — USD per 1M tokens"
						micros={v("pricing_openai_input_per_mtok_micros") as number}
						onChange={(n) => s("pricing_openai_input_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Output — USD per 1M tokens"
						micros={v("pricing_openai_output_per_mtok_micros") as number}
						onChange={(n) => s("pricing_openai_output_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Web search — USD per call"
						hint="Flat per-call fee for the built-in web_search tool."
						micros={v("pricing_web_search_per_call_micros") as number}
						onChange={(n) => s("pricing_web_search_per_call_micros", n)}
						precision={4}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Perplexity
						</h3>
						<p className="m-0 text-xs text-muted-foreground">
							Perplexity splits a call into input + output tokens plus a flat
							request fee that varies with search context size.{" "}
							<a
								className="underline underline-offset-2"
								href="https://docs.perplexity.ai/getting-started/pricing"
								target="_blank"
								rel="noreferrer"
							>
								Perplexity pricing →
							</a>
						</p>
					</div>
					<UsdField
						label="Input — USD per 1M tokens"
						micros={v("pricing_perplexity_input_per_mtok_micros") as number}
						onChange={(n) => s("pricing_perplexity_input_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Output — USD per 1M tokens"
						micros={v("pricing_perplexity_output_per_mtok_micros") as number}
						onChange={(n) => s("pricing_perplexity_output_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Request fee — USD per call"
						hint="Low-context fee by default. Bump if you switch to high-context search."
						micros={v("pricing_perplexity_request_fee_micros") as number}
						onChange={(n) => s("pricing_perplexity_request_fee_micros", n)}
						precision={4}
					/>
				</CardContent>
			</Card>

			<ReasonField
				value={reason}
				onChange={setReason}
				hasChanges={hasChanges}
				helpText="Why are you changing the pricing? Include the source you verified against (e.g. 'OpenAI raised gpt-5-mini output to $1.20/M on 2026-04-22')."
			/>

			<SaveRow
				submitting={update.isPending}
				disabled={!canSubmit}
				flash={flash}
				error={update.isError ? update.error.message : null}
			/>

			<ChangeHistoryCard
				title="Recent Pricing changes"
				fieldFilter={(f) => PRICING_FIELDS.has(f)}
			/>
		</form>
	);
}

function PricingIntroBanner() {
	return (
		<Card className="border-[var(--theme-warning,theme(colors.amber.500))]/40">
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<span
						className="inline-block h-2.5 w-2.5 rounded-full"
						style={{
							background: "var(--theme-warning,theme(colors.amber.500))",
						}}
					/>
					<h3 className="m-0 text-sm font-semibold">
						Think twice before editing
					</h3>
				</div>
				<div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">
							What these rates drive
						</p>
						<p className="m-0">
							Every turn's cost is{" "}
							<code className="rounded bg-[var(--theme-surface)] px-1">
								tokens × rate
							</code>
							. That cost is then converted into user credits using the{" "}
							<em>Credit → USD value</em> on the Credits tab. A wrong rate here
							silently mis-charges every user, every turn, until it's fixed.
						</p>
					</div>
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">
							Why we can't auto-pull them
						</p>
						<p className="m-0">
							Neither OpenAI nor Perplexity exposes a per-model pricing API —
							rates only live on their public pricing pages and in release
							notes. OpenAI's{" "}
							<code className="rounded bg-[var(--theme-surface)] px-1">
								/v1/organization/costs
							</code>{" "}
							returns spend, not rates. We watch the pricing pages manually and
							mirror them here.
						</p>
					</div>
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">What goes wrong</p>
						<p className="m-0">
							<span className="font-medium">Too low:</span> turns look cheap,
							credits don't deplete fast enough, we overspend real money.{" "}
							<span className="font-medium">Too high:</span> users get blocked
							or downgraded when they shouldn't. Save a reason so whoever audits
							next month knows what you verified against.
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Controls — kill switches
// ---------------------------------------------------------------------------

function ControlsTab() {
	const state = useBudgetStateQuery();
	const flags = useUpdateFlagsMutation();

	if (state.isPending) return <LoadingState />;
	if (state.isError) return <ErrorState message={state.error.message} />;
	const s = state.data;
	if (!s) return null;

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardContent className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="m-0 text-sm font-semibold">Perplexity degraded</h3>
							<p className="m-0 mt-1 text-xs text-muted-foreground">
								{s.perplexity_degraded
									? "Sonar is OFF. Chat still works via OpenAI + web_search."
									: "Sonar is ON. Users can use grounded research tools."}
							</p>
						</div>
						<Button
							variant={s.perplexity_degraded ? "outline" : "destructive"}
							disabled={flags.isPending}
							onClick={() =>
								flags.mutate({
									perplexity_degraded: !s.perplexity_degraded,
								})
							}
						>
							{s.perplexity_degraded ? "Re-enable Sonar" : "Force degrade"}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="m-0 text-sm font-semibold">Hard stop</h3>
							<p className="m-0 mt-1 text-xs text-muted-foreground">
								{s.hard_stopped
									? "Chat is paused for everyone except admins."
									: "Chat is live. Engage only in an emergency — this pauses all mentees immediately."}
							</p>
						</div>
						<Button
							variant={s.hard_stopped ? "outline" : "destructive"}
							disabled={flags.isPending}
							onClick={() => flags.mutate({ hard_stopped: !s.hard_stopped })}
						>
							{s.hard_stopped ? "Resume chat" : "Pause all chat"}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Shared form primitives
// ---------------------------------------------------------------------------

function IntField({
	label,
	hint,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	value: number;
	onChange: (n: number) => void;
}) {
	return (
		<Field label={label} hint={hint}>
			<Input
				type="number"
				min={0}
				value={Number.isFinite(value) ? String(value) : ""}
				onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || 0)}
			/>
		</Field>
	);
}

function UsdField({
	label,
	hint,
	micros,
	onChange,
	precision = 2,
}: {
	label: string;
	hint?: string;
	micros: number;
	onChange: (nextMicros: number) => void;
	precision?: number;
}) {
	const usd = (micros / 1_000_000).toFixed(precision);
	return (
		<Field label={label} hint={hint}>
			<div className="relative">
				<span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
					$
				</span>
				<Input
					type="number"
					step={precision >= 4 ? "0.0001" : "0.01"}
					min={0}
					value={usd}
					onChange={(e) => {
						const n = Number.parseFloat(e.target.value);
						if (!Number.isFinite(n) || n < 0) return onChange(0);
						onChange(Math.round(n * 1_000_000));
					}}
					className="pl-6"
				/>
			</div>
		</Field>
	);
}

function ReasonField({
	value,
	onChange,
	hasChanges,
	helpText,
}: {
	value: string;
	onChange: (next: string) => void;
	hasChanges: boolean;
	helpText: string;
}) {
	const trimmed = value.trim();
	const tooShort = hasChanges && trimmed.length > 0 && trimmed.length < 5;
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<label className="flex flex-col gap-1" htmlFor="config-change-reason">
					<span className="text-sm font-medium">
						Reason for change{" "}
						<span className="text-xs font-normal text-muted-foreground">
							(required)
						</span>
					</span>
					<span className="text-xs text-muted-foreground">{helpText}</span>
				</label>
				<textarea
					id="config-change-reason"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					rows={3}
					placeholder="e.g. Matching OpenAI's 2026-04-22 price drop on gpt-5-mini output ($2.00 → $1.20 / M)."
					className={cn(
						"w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none",
						"placeholder:text-muted-foreground",
						"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
						tooShort &&
							"border-destructive aria-invalid:ring-destructive/40 aria-[invalid='true']:ring-destructive/40",
					)}
					aria-invalid={tooShort ? "true" : undefined}
				/>
				{tooShort ? (
					<p className="m-0 text-[11px] text-destructive">
						Please write at least 5 characters.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function SaveRow({
	submitting,
	disabled,
	flash,
	error,
}: {
	submitting: boolean;
	disabled: boolean;
	flash: string | null;
	error: string | null;
}) {
	return (
		<div className="flex items-center gap-3">
			<Button type="submit" disabled={disabled}>
				{submitting ? "Saving…" : "Save changes"}
			</Button>
			{flash ? (
				<span className="text-xs text-muted-foreground">{flash}</span>
			) : null}
			{error ? <span className="text-xs text-destructive">{error}</span> : null}
		</div>
	);
}

function ChangeHistoryCard({
	title,
	fieldFilter,
}: {
	title: string;
	fieldFilter: (field: string) => boolean;
}) {
	const history = useBudgetConfigHistoryQuery();
	const filtered: BudgetConfigChange[] =
		history.data?.changes.filter((c) => fieldFilter(c.field)) ?? [];

	return (
		<Card>
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{title}
					</h3>
					<p className="m-0 text-[11px] text-muted-foreground">
						Last 50 edits, newest first.
					</p>
				</div>
				{history.isPending ? (
					<p className="m-0 text-xs text-muted-foreground">Loading history…</p>
				) : history.isError ? (
					<p className="m-0 text-xs text-destructive">
						{history.error.message}
					</p>
				) : filtered.length === 0 ? (
					<p className="m-0 text-xs text-muted-foreground">
						No changes yet. Saved edits will appear here with the reason you
						provided.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>When</TableHead>
								<TableHead>Field</TableHead>
								<TableHead>Old</TableHead>
								<TableHead>New</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Admin</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="text-xs text-muted-foreground">
										{new Date(c.changed_at).toLocaleString(undefined, {
											month: "short",
											day: "numeric",
											hour: "numeric",
											minute: "2-digit",
										})}
									</TableCell>
									<TableCell className="text-xs">
										{FIELD_META[c.field]?.label ?? c.field}
									</TableCell>
									<TableCell className="text-xs tabular-nums">
										{formatFieldValue(c.field, c.old_value)}
									</TableCell>
									<TableCell className="text-xs tabular-nums font-semibold">
										{formatFieldValue(c.field, c.new_value)}
									</TableCell>
									<TableCell
										className="max-w-[320px] whitespace-normal text-xs text-muted-foreground"
										title={c.reason}
									>
										{c.reason}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{c.actor_email}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
