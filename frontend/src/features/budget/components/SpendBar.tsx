import { clampPct, formatMicros } from "#/features/budget/lib/format";
import { cn } from "#/lib/utils";

interface SpendBarProps {
	label: string;
	spentMicros: number;
	budgetMicros: number;
	degradeThresholdPct?: number;
	hardStopThresholdPct?: number;
	warn?: boolean;
	stopped?: boolean;
}

export function SpendBar({
	label,
	spentMicros,
	budgetMicros,
	degradeThresholdPct,
	hardStopThresholdPct,
	warn,
	stopped,
}: SpendBarProps) {
	const pct = clampPct(spentMicros, budgetMicros);
	const state: "ok" | "warn" | "danger" =
		stopped || pct >= (hardStopThresholdPct ?? 95)
			? "danger"
			: warn || pct >= (degradeThresholdPct ?? 90)
				? "warn"
				: "ok";

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-3">
				<p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</p>
				<p className="m-0 text-sm font-semibold tabular-nums">
					{formatMicros(spentMicros)} / {formatMicros(budgetMicros)}
				</p>
			</div>
			<div className="relative h-2 overflow-hidden rounded-full bg-[var(--theme-surface)]">
				<div
					className={cn(
						"h-full transition-all",
						state === "danger" && "bg-[var(--theme-danger)]",
						state === "warn" &&
							"bg-[var(--theme-warning,theme(colors.amber.500))]",
						state === "ok" && "bg-[var(--theme-accent)]",
					)}
					style={{ width: `${Math.max(2, pct)}%` }}
				/>
			</div>
			<p className="m-0 text-[11px] text-muted-foreground">
				{pct.toFixed(1)}% of monthly cap
			</p>
		</div>
	);
}
