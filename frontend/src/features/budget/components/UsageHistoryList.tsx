import type { ReactNode } from "react";
import { Card, CardContent } from "#/components/ui/card";
import { InfoTooltip } from "#/components/ui/info-tooltip";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { MessageUsage } from "#/features/budget/data/budget.types";
import { formatMicros } from "#/features/budget/lib/format";

function HeaderCell({
	label,
	title,
	tooltip,
	align,
}: {
	label: string;
	title: string;
	tooltip: ReactNode;
	align?: "right";
}) {
	return (
		<TableHead className={align === "right" ? "text-right" : undefined}>
			<span
				className={
					align === "right"
						? "inline-flex items-center justify-end gap-1.5"
						: "inline-flex items-center gap-1.5"
				}
			>
				{label}
				<InfoTooltip title={title}>{tooltip}</InfoTooltip>
			</span>
		</TableHead>
	);
}

export function UsageHistoryList({ rows }: { rows: MessageUsage[] }) {
	if (rows.length === 0) {
		return (
			<Card>
				<CardContent>
					<p className="m-0 text-sm text-muted-foreground">
						No usage recorded yet this period.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent className="px-0 py-0">
				<Table>
					<TableHeader>
						<TableRow>
							<HeaderCell
								label="When"
								title="When"
								tooltip="The time this turn was processed by the mentor."
							/>
							<HeaderCell
								label="Provider"
								title="Provider"
								tooltip={
									<>
										<p className="m-0">
											Which provider handled this row: <code>openai</code>,{" "}
											<code>perplexity</code>, or <code>web_search</code> (an
											OpenAI builtin tool). A single turn can produce one row
											per provider.
										</p>
										<p className="m-0 mt-2">
											When known, the specific model SKU (e.g. gpt-5.4-mini,
											sonar-pro) is shown underneath. Older rows pre-date SKU
											capture and show only the provider.
										</p>
									</>
								}
							/>
							<HeaderCell
								label="Input"
								title="Input tokens"
								align="right"
								tooltip={
									<>
										<p className="m-0">
											Tokens sent to the provider on this row — the user's
											question plus relevant prior context. For Perplexity rows
											this is summed across every Perplexity call in the turn;
											for web_search it's always 0 (the OpenAI builtin doesn't
											expose token counts).
										</p>
										<p className="m-0 mt-2">
											1,000,000 tokens ≈ 750,000 words.
										</p>
									</>
								}
							/>
							<HeaderCell
								label="Output"
								title="Output tokens"
								align="right"
								tooltip="Tokens the provider returned on this row. Same caveat as Input — summed across Perplexity calls in the turn, always 0 for web_search."
							/>
							<HeaderCell
								label="Calls"
								title="API calls"
								align="right"
								tooltip={
									<>
										<p className="m-0">How many provider requests this row represents.</p>
										<p className="m-0 mt-2">
											OpenAI rows are always 1 even when the model did several
											internal hops. Perplexity rows reflect the actual number of
											tool calls. web_search rows count each builtin invocation.
										</p>
									</>
								}
							/>
							<HeaderCell
								label="Cost"
								title="Estimated cost"
								align="right"
								tooltip="Cost of this provider call in USD, based on the rates configured under Budget → Pricing. Multi-provider turns produce one row per provider — sum rows with the same timestamp for the turn total."
							/>
							<HeaderCell
								label="Credits"
								title="Credits charged"
								align="right"
								tooltip="Credits deducted from the user's balance for the whole turn. Stamped on the first row of each turn; subsequent rows show — to avoid double-counting. Configured under Budget → Credits."
							/>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell className="text-xs text-muted-foreground">
									{new Date(row.created_at).toLocaleString(undefined, {
										month: "short",
										day: "numeric",
										hour: "numeric",
										minute: "2-digit",
									})}
								</TableCell>
								<TableCell className="font-medium">
									{row.model_sku ? (
										<span className="flex flex-col leading-tight">
											<span>{row.model_sku}</span>
											<span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
												{row.model}
											</span>
										</span>
									) : (
										row.model
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.input_tokens.toLocaleString()}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.output_tokens.toLocaleString()}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.request_count}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatMicros(row.cost_usd_micros, { precision: 4 })}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.credits_charged || "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
