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
								label="Model"
								title="Model"
								tooltip="The exact AI model that handled this turn (e.g. gpt-5-mini, sonar)."
							/>
							<HeaderCell
								label="Input"
								title="Input tokens"
								align="right"
								tooltip={
									<>
										<p className="m-0">
											Tokens we sent to the AI provider — the user's question
											plus all relevant prior context for this turn.
										</p>
										<p className="m-0 mt-2">
											1,000,000 tokens ≈ 750,000 words. Bigger numbers usually
											mean longer conversations or richer context.
										</p>
									</>
								}
							/>
							<HeaderCell
								label="Output"
								title="Output tokens"
								align="right"
								tooltip="Tokens the AI provider returned — the mentor's reply for this turn. Output is usually billed higher than input."
							/>
							<HeaderCell
								label="Calls"
								title="API calls"
								align="right"
								tooltip="How many provider requests this turn made. Most chat turns are 1; research questions can fan out into several calls."
							/>
							<HeaderCell
								label="Cost"
								title="Estimated cost"
								align="right"
								tooltip="Our estimate of what this turn cost in USD, based on the rates configured under Budget → Pricing."
							/>
							<HeaderCell
								label="Credits"
								title="Credits charged"
								align="right"
								tooltip="How many credits we deducted from this user's balance for this turn. Configured under Budget → Credits."
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
								<TableCell className="font-medium">{row.model}</TableCell>
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
