import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { InfoTooltip } from "#/components/ui/info-tooltip";
import type { ProviderSpend } from "#/features/budget/data/budget.types";
import {
	useBudgetProvidersQuery,
	useRefreshProvidersMutation,
} from "#/features/budget/hooks/useBudget";
import { formatMicros } from "#/features/budget/lib/format";

const PROVIDER_LABELS: Record<string, string> = {
	openai: "ChatGPT (OpenAI)",
	perplexity: "Research assistant (Perplexity)",
};

export function ProvidersCard() {
	const providers = useBudgetProvidersQuery();
	const refresh = useRefreshProvidersMutation();

	return (
		<Card>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="m-0 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Actual bill this month
							<InfoTooltip title="Actual bill this month">
								<p className="m-0">
									These numbers come straight from OpenAI and Perplexity. They
									reflect everything charged to the API key this month, not just
									this chatbot.
								</p>
								<p className="m-0 mt-2">
									Use the <b>Dashboard</b> link on each card to see your full
									billing details and remaining credit.
								</p>
							</InfoTooltip>
						</h3>
						<p className="m-0 mt-1 text-xs text-muted-foreground">
							The real numbers from each provider — updated every few minutes.
						</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						onClick={() => refresh.mutate()}
						disabled={refresh.isPending || providers.isFetching}
						className="gap-1.5"
					>
						<RefreshCw
							size={14}
							className={refresh.isPending ? "animate-spin" : ""}
						/>
						Refresh
					</Button>
				</div>

				{providers.isPending ? (
					<p className="m-0 text-sm text-muted-foreground">
						Loading providers…
					</p>
				) : providers.isError ? (
					<p className="m-0 text-sm text-destructive">
						{providers.error.message}
					</p>
				) : providers.data ? (
					<div className="grid gap-3 sm:grid-cols-2">
						<ProviderRow
							data={providers.data.openai}
							label={PROVIDER_LABELS.openai}
						/>
						<ProviderRow
							data={providers.data.perplexity}
							label={PROVIDER_LABELS.perplexity}
						/>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function ProviderRow({ data, label }: { data: ProviderSpend; label: string }) {
	const ledger =
		typeof data.ledger_spend_micros === "number"
			? data.ledger_spend_micros
			: null;
	const drift =
		data.available && ledger != null ? data.spend_micros - ledger : null;
	const significantDrift = drift != null && Math.abs(drift) > 1_000_000;

	return (
		<div className="rounded-lg border bg-[var(--theme-surface)] p-4">
			<div className="flex items-baseline justify-between gap-2">
				<p className="m-0 text-sm font-semibold">{label}</p>
				{data.dashboard_url ? (
					<a
						href={data.dashboard_url}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
					>
						Dashboard <ExternalLink size={10} />
					</a>
				) : null}
			</div>

			{data.available ? (
				<div className="mt-2 flex flex-col gap-1">
					<p className="m-0 text-2xl font-semibold tabular-nums">
						{formatMicros(data.spend_micros)}
						<span className="ml-2 text-[11px] font-normal text-muted-foreground">
							billed this month
						</span>
					</p>
					<p className="m-0 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
						Our estimate: {formatMicros(ledger)}
						{drift != null ? (
							<>
								{" "}
								<span
									className={
										significantDrift
											? "font-medium text-[var(--theme-danger)]"
											: undefined
									}
								>
									({drift >= 0 ? "under" : "over"} by{" "}
									{formatMicros(Math.abs(drift))})
								</span>
								<InfoTooltip title="What's this difference?">
									<p className="m-0">
										We keep our own estimate of what the chatbot costs. A small
										gap is normal — the provider's bill covers everything on the
										API key, including other tools that might share it.
									</p>
									<p className="m-0 mt-2">
										A large gap (more than $1.00) may mean our pricing rates are
										out of date — review the <b>Pricing</b> tab.
									</p>
								</InfoTooltip>
							</>
						) : null}
					</p>
					{data.fetched_at ? (
						<p className="m-0 text-[10px] text-muted-foreground">
							Refreshed {new Date(data.fetched_at).toLocaleTimeString()}
						</p>
					) : null}
				</div>
			) : (
				<div className="mt-2 flex flex-col gap-1">
					<p className="m-0 text-sm text-muted-foreground">
						Live billing not available
					</p>
					{data.reason ? (
						<p className="m-0 text-xs text-muted-foreground">{data.reason}</p>
					) : null}
					{ledger != null ? (
						<p className="m-0 text-xs text-muted-foreground">
							Our estimate: {formatMicros(ledger)}
						</p>
					) : null}
				</div>
			)}
		</div>
	);
}
