import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import type { ProviderSpend } from "#/features/budget/data/budget.types";
import {
	useBudgetProvidersQuery,
	useRefreshProvidersMutation,
} from "#/features/budget/hooks/useBudget";
import { formatMicros } from "#/features/budget/lib/format";

export function ProvidersCard() {
	const providers = useBudgetProvidersQuery();
	const refresh = useRefreshProvidersMutation();

	return (
		<Card>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
							Month-to-date spend (provider billing)
						</h3>
						<p className="m-0 mt-1 text-xs text-muted-foreground">
							How much you've <b>spent</b> this month per the provider's API —
							not your remaining credit balance. Includes all traffic on the
							key, not only this bot. Click the dashboard link on each card to
							view balance.
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
						<ProviderRow data={providers.data.openai} label="OpenAI" />
						<ProviderRow data={providers.data.perplexity} label="Perplexity" />
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
							spent this month
						</span>
					</p>
					<p className="m-0 text-xs text-muted-foreground">
						Bot ledger says {formatMicros(ledger)}
						{drift != null ? (
							<>
								{" "}
								·{" "}
								<span
									className={
										Math.abs(drift) > 1_000_000
											? "font-medium text-[var(--theme-danger)]"
											: undefined
									}
								>
									Δ {drift >= 0 ? "+" : ""}
									{formatMicros(Math.abs(drift))}
								</span>
							</>
						) : null}
					</p>
					{data.fetched_at ? (
						<p className="m-0 text-[10px] text-muted-foreground">
							Fetched {new Date(data.fetched_at).toLocaleTimeString()}
						</p>
					) : null}
				</div>
			) : (
				<div className="mt-2 flex flex-col gap-1">
					<p className="m-0 text-sm text-muted-foreground">Not available</p>
					{data.reason ? (
						<p className="m-0 text-xs text-muted-foreground">{data.reason}</p>
					) : null}
					{ledger != null ? (
						<p className="m-0 text-xs text-muted-foreground">
							Our ledger: {formatMicros(ledger)}
						</p>
					) : null}
				</div>
			)}
		</div>
	);
}
