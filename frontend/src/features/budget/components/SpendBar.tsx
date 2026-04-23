import { formatMicros } from "#/features/budget/lib/format";
import { cn } from "#/lib/utils";

interface SpendBarProps {
	label: string;
	spentMicros: number;
	warn?: boolean;
	stopped?: boolean;
}

export function SpendBar({ label, spentMicros, warn, stopped }: SpendBarProps) {
	const state: "ok" | "warn" | "danger" = stopped
		? "danger"
		: warn
			? "warn"
			: "ok";

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-3">
				<p className="m-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</p>
				<p className="m-0 text-sm font-semibold tabular-nums">
					{formatMicros(spentMicros)}
				</p>
			</div>
			<div
				className={cn(
					"h-1.5 rounded-full",
					state === "danger" && "bg-[var(--theme-danger)]",
					state === "warn" &&
						"bg-[var(--theme-warning,theme(colors.amber.500))]",
					state === "ok" && "bg-[var(--theme-accent)]",
				)}
			/>
		</div>
	);
}
