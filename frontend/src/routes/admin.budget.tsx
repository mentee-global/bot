import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { InfoTooltip } from "#/components/ui/info-tooltip";
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
		label: "Monthly credits per user",
		kind: "credits_int",
	},
	credit_usd_value_micros: {
		label: "Value of one credit",
		kind: "credits_usd",
	},
	pricing_openai_input_per_mtok_micros: {
		label: "ChatGPT — price per million input words",
		kind: "pricing_usd",
	},
	pricing_openai_output_per_mtok_micros: {
		label: "ChatGPT — price per million output words",
		kind: "pricing_usd",
	},
	pricing_perplexity_input_per_mtok_micros: {
		label: "Research assistant — price per million input words",
		kind: "pricing_usd",
	},
	pricing_perplexity_output_per_mtok_micros: {
		label: "Research assistant — price per million output words",
		kind: "pricing_usd",
	},
	pricing_perplexity_request_fee_micros: {
		label: "Research assistant — fee per request",
		kind: "pricing_usd",
	},
	pricing_web_search_per_call_micros: {
		label: "Web search — fee per search",
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
	return formatMicros(value, {
		precision: meta.kind === "pricing_usd" ? 4 : 2,
	});
}

// Shared tooltip bodies — each admin-facing term has one canonical explanation.
function TokensExplainer() {
	return (
		<>
			<p className="m-0">
				AI providers measure conversation length in <b>tokens</b>, not words.
				One token is roughly three-quarters of an English word, so 1,000,000
				tokens ≈ 750,000 words.
			</p>
			<p className="m-0 mt-2">
				You almost never need to think about this — the page converts rates into
				dollars for you. It only matters when an admin is comparing our rate
				against the provider's published price per million tokens.
			</p>
		</>
	);
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
// Overview — what's happened this month
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
			<TabIntro
				title={`How things are going — ${periodLabel}`}
				body="A live summary of what the chatbot has cost this month and whether anything needs your attention. Numbers reset on the 1st of each month."
			/>

			<Card>
				<CardContent className="flex flex-col gap-2">
					<p className="m-0 flex items-center gap-2 text-sm font-medium text-muted-foreground">
						Estimated spend so far
						<InfoTooltip title="How is this calculated?">
							<p className="m-0">
								We keep our own running estimate of what the chatbot costs based
								on how long each conversation is and the prices on the{" "}
								<b>Pricing</b> tab.
							</p>
							<p className="m-0 mt-2">
								It's an estimate, not a bill. The true numbers live in{" "}
								<b>Actual bill this month</b> below, straight from OpenAI and
								Perplexity.
							</p>
						</InfoTooltip>
					</p>
					<h2 className="m-0 text-3xl font-semibold tabular-nums">
						{formatMicros(s.total_spend_micros)}
					</h2>
				</CardContent>
			</Card>

			<FlagReasonBanner state={s} />

			<div className="flex flex-col gap-2">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						Estimated spend by service
						<InfoTooltip title="What are these services?">
							<p className="m-0">
								The chatbot uses three paid services behind the scenes:
							</p>
							<ul className="m-0 mt-2 list-disc pl-4">
								<li>
									<b>ChatGPT</b> — writes the mentor's replies.
								</li>
								<li>
									<b>Research assistant</b> — pulls in-depth answers from the
									web for scholarship and study-abroad questions.
								</li>
								<li>
									<b>Web search</b> — quick lookups for facts and recent news.
								</li>
							</ul>
						</InfoTooltip>
					</h3>
					<p className="m-0 text-[11px] text-muted-foreground">
						Our estimate — see the actual bill below.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="ChatGPT (OpenAI)"
								spentMicros={s.openai_spend_micros}
								stopped={s.hard_stopped}
							/>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="Research assistant (Perplexity)"
								spentMicros={s.perplexity_spend_micros}
								warn={s.perplexity_degraded}
							/>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<SpendBar
								label="Web search"
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
							label="Research assistant"
							active={!s.perplexity_degraded}
							hint={
								s.perplexity_degraded
									? "Off. Users can still chat, but answers won't include deep research."
									: "On. Research answers available."
							}
						/>
						<FlagRow
							label="Chat availability"
							active={!s.hard_stopped}
							hint={
								s.hard_stopped
									? "Paused. No one can chat until this is turned back on."
									: "Live. Users can chat normally."
							}
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
					title="Research assistant is off"
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
		<Card className="border-[var(--theme-accent-ring)]">
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
						Started {when}. Go to <b>Controls</b> to turn it back on.
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
						active ? "bg-[var(--theme-accent)]" : "bg-[var(--theme-danger)]"
					}`}
				/>
				{label}
				<span className="ml-1 text-xs font-normal text-muted-foreground">
					{active ? "on" : "off"}
				</span>
			</dt>
			<dd className="m-0 mt-1 text-xs text-muted-foreground">{hint}</dd>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Credits — how much usage each user gets per month
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
			<CreditsIntroBanner />

			<Card>
				<CardContent className="flex flex-col gap-4">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						Defaults for new users
					</h3>
					<IntField
						label="Monthly credits per user"
						hint="The starting balance every user gets on the 1st of each month."
						tooltip={
							<>
								<p className="m-0">
									How many credits each user starts the month with. Think of it
									as their monthly allowance for talking to the mentor.
								</p>
								<p className="m-0 mt-2">
									Raise it if users report running out early. Lower it if the
									monthly bill is growing faster than you'd like.
								</p>
							</>
						}
						value={val("default_monthly_credits") as number}
						onChange={(n) => set("default_monthly_credits", n)}
					/>
					<UsdField
						label="Value of one credit"
						hint="How much one credit is worth in dollars of AI usage."
						tooltip={
							<>
								<p className="m-0">
									One credit covers roughly this much spending on the AI
									providers. Example: at <b>$0.01</b>, a user with 100 credits
									can use up to $1 worth of chat each month.
								</p>
								<p className="m-0 mt-2">
									Lowering this number makes credits stricter — the same monthly
									allowance covers fewer messages. Raising it is more generous.
								</p>
							</>
						}
						micros={val("credit_usd_value_micros") as number}
						onChange={(n) => set("credit_usd_value_micros", n)}
					/>
				</CardContent>
			</Card>

			<ReasonField
				value={reason}
				onChange={setReason}
				hasChanges={hasChanges}
				helpText="Why are you making this change? A short note helps whoever audits this later understand the decision."
				placeholder="e.g. Raised monthly credits from 100 to 150 so active mentees stop hitting their limit mid-month."
			/>

			<SaveRow
				submitting={update.isPending}
				disabled={!canSubmit}
				flash={flash}
				error={update.isError ? update.error.message : null}
			/>

			<ChangeHistoryCard
				title="Past changes"
				subtitle="Every edit to the credit settings is recorded here."
				fieldFilter={(f) => CREDITS_FIELDS.has(f)}
			/>
		</form>
	);
}

function CreditsIntroBanner() {
	return (
		<TabIntro
			title="How credits work"
			body={
				<>
					Credits are how we cap usage so one user can't burn through the whole
					monthly budget. Each user gets a fresh balance on the 1st; every
					message they send uses some credits based on how long the conversation
					is. Change the defaults below — individual users can be adjusted
					separately from <b>Users → Billing</b>.
				</>
			}
		/>
	);
}

// ---------------------------------------------------------------------------
// Pricing — provider rates
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
						<h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							ChatGPT (OpenAI)
							<InfoTooltip title="ChatGPT (OpenAI)">
								<p className="m-0">
									The service that writes the mentor's replies. OpenAI charges
									separately for what the user types (<b>input</b>) and what the
									mentor writes back (<b>output</b>) — output is usually more
									expensive.
								</p>
							</InfoTooltip>
						</h3>
						<p className="m-0 text-xs text-muted-foreground">
							Find the current rates on OpenAI's pricing page, pick the exact
							model we use, and paste those numbers here.{" "}
							<a
								className="underline underline-offset-2"
								href="https://openai.com/api/pricing/"
								target="_blank"
								rel="noreferrer"
							>
								Open OpenAI pricing →
							</a>
						</p>
					</div>
					<UsdField
						label="Price per million input words"
						tooltip={
							<>
								<p className="m-0">
									What OpenAI charges us for the words <b>the user sends</b> to
									the chatbot, per 1,000,000 tokens.
								</p>
								<p className="m-0 mt-2">
									Find the exact number on OpenAI's pricing page under the model
									name we're running.
								</p>
							</>
						}
						micros={v("pricing_openai_input_per_mtok_micros") as number}
						onChange={(n) => s("pricing_openai_input_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Price per million output words"
						tooltip={
							<p className="m-0">
								What OpenAI charges us for the words{" "}
								<b>the mentor replies with</b>, per 1,000,000 tokens. Usually
								higher than the input price.
							</p>
						}
						micros={v("pricing_openai_output_per_mtok_micros") as number}
						onChange={(n) => s("pricing_openai_output_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Web search fee per search"
						tooltip={
							<p className="m-0">
								Flat fee OpenAI charges every time the chatbot does a quick web
								search to fact-check something. Charged per search, not per
								word.
							</p>
						}
						micros={v("pricing_web_search_per_call_micros") as number}
						onChange={(n) => s("pricing_web_search_per_call_micros", n)}
						precision={4}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Research assistant (Perplexity)
							<InfoTooltip title="Research assistant (Perplexity)">
								<p className="m-0">
									The service that pulls detailed answers from the web for
									scholarship and study-abroad questions. Perplexity charges for
									input words, output words, <b>and</b> a flat fee per search
									request.
								</p>
							</InfoTooltip>
						</h3>
						<p className="m-0 text-xs text-muted-foreground">
							Perplexity's rates are listed on their pricing page — pick the
							exact model we use.{" "}
							<a
								className="underline underline-offset-2"
								href="https://docs.perplexity.ai/getting-started/pricing"
								target="_blank"
								rel="noreferrer"
							>
								Open Perplexity pricing →
							</a>
						</p>
					</div>
					<UsdField
						label="Price per million input words"
						tooltip="What Perplexity charges for the words sent to it, per 1,000,000 tokens."
						micros={v("pricing_perplexity_input_per_mtok_micros") as number}
						onChange={(n) => s("pricing_perplexity_input_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Price per million output words"
						tooltip="What Perplexity charges for the research answer it returns, per 1,000,000 tokens."
						micros={v("pricing_perplexity_output_per_mtok_micros") as number}
						onChange={(n) => s("pricing_perplexity_output_per_mtok_micros", n)}
						precision={4}
					/>
					<UsdField
						label="Fee per research request"
						tooltip={
							<>
								<p className="m-0">
									Flat fee Perplexity charges for every research request, on top
									of the word-based prices above.
								</p>
								<p className="m-0 mt-2">
									This number assumes <b>low-context</b> search. If the mentor
									is configured to use high-context search, the fee is higher —
									check the pricing page.
								</p>
							</>
						}
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
				helpText="Include the source you checked. A future admin reading this should be able to tell what price update you were tracking."
				placeholder="e.g. OpenAI announced on 2026-04-22 that gpt-5-mini output dropped from $2.00 to $1.20 per million tokens."
			/>

			<SaveRow
				submitting={update.isPending}
				disabled={!canSubmit}
				flash={flash}
				error={update.isError ? update.error.message : null}
			/>

			<ChangeHistoryCard
				title="Past changes"
				subtitle="Every pricing edit is recorded with the admin, date, and reason."
				fieldFilter={(f) => PRICING_FIELDS.has(f)}
			/>
		</form>
	);
}

function PricingIntroBanner() {
	return (
		<Card className="border-[var(--theme-accent-ring)] bg-[var(--theme-accent-soft)]/40">
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<span
						className="inline-block h-2.5 w-2.5 rounded-full"
						style={{ background: "var(--theme-accent)" }}
					/>
					<h3 className="m-0 text-sm font-semibold">
						Please read before editing
					</h3>
					<InfoTooltip title="What are tokens?" side="bottom">
						<TokensExplainer />
					</InfoTooltip>
				</div>
				<div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">
							What these numbers are for
						</p>
						<p className="m-0">
							These are the prices OpenAI and Perplexity charge us. They're how
							we estimate the monthly bill and how we decide how much each
							user's chat costs in credits. Numbers here should match what the
							providers show on their pricing pages.
						</p>
					</div>
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">
							Why you have to update them manually
						</p>
						<p className="m-0">
							Neither OpenAI nor Perplexity gives us a way to read their current
							prices automatically. They only publish them on their website and
							in release announcements. Watch those pages and update these
							fields when you see a change.
						</p>
					</div>
					<div className="flex flex-col gap-1">
						<p className="m-0 font-semibold text-foreground">
							What happens if a number is wrong
						</p>
						<p className="m-0">
							Too low: chats look cheaper than they are, users send more
							messages than we can afford, and our bill grows faster than the
							Overview tab suggests. Too high: users get blocked even though
							they still have real budget left. Save a reason so we can trace
							what you verified.
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Controls — emergency switches
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
			<TabIntro
				title="Emergency switches"
				body="Manual overrides to turn parts of the chatbot off and back on. The system flips these automatically when a provider runs out of credit — the reason shows on Overview when it happens. Use these buttons to override manually."
			/>

			<Card>
				<CardContent className="flex flex-col gap-3">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
								Research assistant
								<InfoTooltip title="Research assistant">
									<p className="m-0">
										Turning this off disables the deep-research service
										(Perplexity). Users can still chat normally and get quick
										web-search answers — they just won't get detailed
										scholarship / study-abroad research.
									</p>
									<p className="m-0 mt-2">
										Use this if the research bill is growing too fast, or the
										provider is unreliable.
									</p>
								</InfoTooltip>
							</h3>
							<p className="m-0 mt-1 text-xs text-muted-foreground">
								{s.perplexity_degraded
									? "Off. Chat still works, but deep research answers are disabled."
									: "On. Users can ask for in-depth research."}
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
							{s.perplexity_degraded ? "Turn back on" : "Turn off"}
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="flex flex-col gap-3">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
								Pause all chat
								<InfoTooltip title="Pause all chat">
									<p className="m-0">
										Stops every user from chatting immediately. Only admins can
										still use the bot.
									</p>
									<p className="m-0 mt-2">
										This is an emergency switch — use it only if something's
										seriously wrong, like we're about to be charged a huge
										unexpected bill, or a bug is causing problems.
									</p>
								</InfoTooltip>
							</h3>
							<p className="m-0 mt-1 text-xs text-muted-foreground">
								{s.hard_stopped
									? "Chat is paused. Users see a friendly 'temporarily unavailable' message."
									: "Chat is live. Pausing stops everyone immediately — think twice."}
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
// Shared UI primitives
// ---------------------------------------------------------------------------

function TabIntro({
	title,
	body,
}: {
	title: string;
	body: string | React.ReactNode;
}) {
	return (
		<Card className="bg-[var(--theme-surface)]">
			<CardContent className="flex flex-col gap-1 py-4">
				<h2 className="m-0 text-base font-semibold">{title}</h2>
				<p className="m-0 text-sm text-muted-foreground">{body}</p>
			</CardContent>
		</Card>
	);
}

function IntField({
	label,
	hint,
	tooltip,
	value,
	onChange,
}: {
	label: string;
	hint?: string;
	tooltip?: React.ReactNode;
	value: number;
	onChange: (n: number) => void;
}) {
	return (
		<Field label={label} hint={hint} tooltip={tooltip}>
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
	tooltip,
	micros,
	onChange,
	precision = 2,
}: {
	label: string;
	hint?: string;
	tooltip?: React.ReactNode;
	micros: number;
	onChange: (nextMicros: number) => void;
	precision?: number;
}) {
	const usd = (micros / 1_000_000).toFixed(precision);
	return (
		<Field label={label} hint={hint} tooltip={tooltip}>
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
	placeholder,
}: {
	value: string;
	onChange: (next: string) => void;
	hasChanges: boolean;
	helpText: string;
	placeholder?: string;
}) {
	const trimmed = value.trim();
	const tooShort = hasChanges && trimmed.length > 0 && trimmed.length < 5;
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<label className="flex flex-col gap-1" htmlFor="config-change-reason">
					<span className="text-sm font-medium">
						Why are you making this change?{" "}
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
					placeholder={placeholder}
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
	subtitle,
	fieldFilter,
}: {
	title: string;
	subtitle?: string;
	fieldFilter: (field: string) => boolean;
}) {
	const history = useBudgetConfigHistoryQuery();
	const filtered: BudgetConfigChange[] =
		history.data?.changes.filter((c) => fieldFilter(c.field)) ?? [];

	return (
		<Card>
			<CardContent className="flex flex-col gap-3">
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{title}
					</h3>
					{subtitle ? (
						<p className="m-0 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
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
								<TableHead>Setting</TableHead>
								<TableHead>From</TableHead>
								<TableHead>To</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Changed by</TableHead>
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
