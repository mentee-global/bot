import { Card, CardContent } from "#/components/ui/card";
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
							<TableHead>When</TableHead>
							<TableHead>Model</TableHead>
							<TableHead className="text-right">Input</TableHead>
							<TableHead className="text-right">Output</TableHead>
							<TableHead className="text-right">Calls</TableHead>
							<TableHead className="text-right">Cost</TableHead>
							<TableHead className="text-right">Credits</TableHead>
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
