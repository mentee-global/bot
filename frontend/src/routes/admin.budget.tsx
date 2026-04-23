import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { ErrorState, LoadingState } from "#/features/admin/components/shared";
import { Field } from "#/features/budget/components/Field";
import { ProvidersCard } from "#/features/budget/components/ProvidersCard";
import { SpendBar } from "#/features/budget/components/SpendBar";
import type {
	BudgetConfig,
	BudgetConfigPatch,
	GlobalSpend,
} from "#/features/budget/data/budget.types";
import {
	useBudgetConfigQuery,
	useBudgetStateQuery,
	useUpdateConfigMutation,
	useUpdateFlagsMutation,
} from "#/features/budget/hooks/useBudget";
import { formatMicros } from "#/features/budget/lib/format";

export const Route = createFileRoute("/admin/budget")({
	component: BudgetRoute,
});

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
// Credits — per-user defaults + credit-to-USD value
// ---------------------------------------------------------------------------

function CreditsTab() {
	const cfg = useBudgetConfigQuery();
	const update = useUpdateConfigMutation();
	const [draft, setDraft] = useState<BudgetConfigPatch>({});
	const [flash, setFlash] = useState<string | null>(null);

	useEffect(() => {
		if (!update.isSuccess) return;
		setFlash("Saved.");
		setDraft({});
		const t = setTimeout(() => setFlash(null), 1800);
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

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const payload: BudgetConfigPatch = Object.fromEntries(
					Object.entries(draft).filter(([, v]) => v !== undefined),
				);
				if (Object.keys(payload).length === 0) return;
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

			<div className="flex items-center gap-3">
				<Button
					type="submit"
					disabled={update.isPending || Object.keys(draft).length === 0}
				>
					{update.isPending ? "Saving…" : "Save changes"}
				</Button>
				{flash ? (
					<span className="text-xs text-muted-foreground">{flash}</span>
				) : null}
				{update.isError ? (
					<span className="text-xs text-destructive">
						{update.error.message}
					</span>
				) : null}
			</div>
		</form>
	);
}

// ---------------------------------------------------------------------------
// Pricing — per-model rates
// ---------------------------------------------------------------------------

function PricingTab() {
	const cfg = useBudgetConfigQuery();
	const update = useUpdateConfigMutation();
	const [draft, setDraft] = useState<BudgetConfigPatch>({});
	const [flash, setFlash] = useState<string | null>(null);

	useEffect(() => {
		if (!update.isSuccess) return;
		setFlash("Saved.");
		setDraft({});
		const t = setTimeout(() => setFlash(null), 1800);
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

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				const payload: BudgetConfigPatch = Object.fromEntries(
					Object.entries(draft).filter(([, val]) => val !== undefined),
				);
				if (Object.keys(payload).length === 0) return;
				update.mutate(payload);
			}}
			className="flex flex-col gap-5"
		>
			<p className="m-0 text-sm text-muted-foreground">
				Rates used to convert token counts into the estimated-spend display and
				per-user credit charge. Adjust when OpenAI or Perplexity change their
				API prices.
			</p>

			<Card>
				<CardContent className="flex flex-col gap-4">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						OpenAI
					</h3>
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
						micros={v("pricing_web_search_per_call_micros") as number}
						onChange={(n) => s("pricing_web_search_per_call_micros", n)}
						precision={4}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-4">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						Perplexity
					</h3>
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

			<div className="flex items-center gap-3">
				<Button
					type="submit"
					disabled={update.isPending || Object.keys(draft).length === 0}
				>
					{update.isPending ? "Saving…" : "Save changes"}
				</Button>
				{flash ? (
					<span className="text-xs text-muted-foreground">{flash}</span>
				) : null}
			</div>
		</form>
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
// Small field primitives
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
