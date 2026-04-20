import { Loader2, SearchCheck, Sparkles } from "lucide-react";
import type { ToolActivity } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";

/**
 * A single generic chip summarising everything the agent is doing under the
 * hood. Users don't need to know which search provider or internal tool is
 * running — only that the mentor is "looking something up". Specific tool
 * names are intentionally hidden.
 */

type BucketKey = "search" | "plan" | "other";

const BUCKET_BY_TOOL: Record<string, BucketKey> = {
	web_search: "search",
	search_perplexity: "search",
	analyze_career_path: "plan",
};

const BUCKET_LABELS: Record<BucketKey, string> = {
	search: "Searching sources",
	plan: "Thinking through a plan",
	other: "Working on it",
};

function pickBucket(activities: readonly ToolActivity[]): BucketKey {
	for (const a of activities) {
		const bucket = BUCKET_BY_TOOL[a.name] ?? "other";
		if (bucket === "search") return "search";
	}
	for (const a of activities) {
		const bucket = BUCKET_BY_TOOL[a.name] ?? "other";
		if (bucket === "plan") return "plan";
	}
	return "other";
}

interface ToolChipRowProps {
	activities: readonly ToolActivity[];
}

export function ToolChipRow({ activities }: ToolChipRowProps) {
	if (activities.length === 0) return null;

	const anyRunning = activities.some((a) => a.status === "running");
	const anyFailed = activities.some(
		(a) => a.outcome === "failed" || a.outcome === "denied",
	);
	const bucket = pickBucket(activities);
	const label = BUCKET_LABELS[bucket];
	const Icon = bucket === "plan" ? Sparkles : SearchCheck;

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
					"border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-secondary)]",
					anyFailed && "border-red-400/40 text-red-500",
				)}
			>
				{anyRunning ? (
					<Loader2 aria-hidden="true" className="size-3 animate-spin" />
				) : (
					<Icon aria-hidden="true" className="size-3" />
				)}
				<span>
					{label}
					{anyRunning ? "…" : anyFailed ? " — failed" : ""}
				</span>
			</span>
		</div>
	);
}
