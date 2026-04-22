import { AlertTriangle, Coins, PauseCircle } from "lucide-react";
import { useMeQuery } from "#/features/budget/hooks/useBudget";
import { cn } from "#/lib/utils";

export function CreditsPill() {
	const me = useMeQuery();
	const data = me.data;
	if (!data) return null;
	if (data.credits.unlimited) return null;

	const { remaining, total, resets_at } = data.credits;
	const { perplexity_degraded, hard_stopped } = data.agent_state;
	const pct = total > 0 ? (remaining / total) * 100 : 0;
	const low = pct <= 20;
	const empty = remaining <= 0;

	const resetsLabel = new Date(resets_at).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

	return (
		<div className="flex items-center gap-2">
			{hard_stopped ? (
				<span
					className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--theme-danger)]"
					title="All chat is paused until the next reset."
				>
					<PauseCircle size={12} />
					Paused
				</span>
			) : perplexity_degraded ? (
				<span
					className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-secondary)]"
					title="Real-time search temporarily disabled to stay within budget."
				>
					<AlertTriangle size={12} />
					Limited search
				</span>
			) : null}
			<span
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums",
					empty
						? "border-[var(--theme-danger)] bg-[var(--theme-danger)]/10 text-[var(--theme-danger)]"
						: low
							? "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)]"
							: "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-secondary)]",
				)}
				title={`Resets on ${resetsLabel}`}
			>
				<Coins size={12} />
				{remaining} / {total} credits
			</span>
		</div>
	);
}
