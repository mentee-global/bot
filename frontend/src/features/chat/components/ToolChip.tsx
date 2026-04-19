import { Globe, Loader2, SearchCheck, Sparkles } from "lucide-react";
import type { ToolActivity } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";

interface ToolChipProps {
	activity: ToolActivity;
}

const LABELS: Record<string, string> = {
	web_search: "Searching the web",
	search_perplexity: "Cross-checking with Perplexity",
	analyze_career_path: "Checking career path",
};

function labelFor(name: string): string {
	return LABELS[name] ?? `Running ${name}`;
}

function iconFor(name: string) {
	if (name === "web_search") return Globe;
	if (name === "search_perplexity") return SearchCheck;
	if (name === "analyze_career_path") return Sparkles;
	return Sparkles;
}

export function ToolChip({ activity }: ToolChipProps) {
	const Icon = iconFor(activity.name);
	const isRunning = activity.status === "running";
	const failed = activity.outcome === "failed" || activity.outcome === "denied";

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
				"border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-secondary)]",
				failed && "border-red-400/40 text-red-500",
			)}
		>
			{isRunning ? (
				<Loader2 aria-hidden="true" className="size-3 animate-spin" />
			) : (
				<Icon aria-hidden="true" className="size-3" />
			)}
			<span>
				{labelFor(activity.name)}
				{isRunning ? "…" : failed ? " — failed" : ""}
			</span>
		</span>
	);
}

interface ToolChipRowProps {
	activities: ToolActivity[];
}

export function ToolChipRow({ activities }: ToolChipRowProps) {
	if (activities.length === 0) return null;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1.5">
			{activities.map((a) => (
				<ToolChip key={a.tool_call_id} activity={a} />
			))}
		</div>
	);
}
