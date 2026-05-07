import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/Skeleton";
import { cn } from "#/lib/utils";

/**
 * Card wrapper for an admin chart. Renders a title, description, and slot
 * for the chart body. Pulled out of `admin.metrics.tsx` so other admin pages
 * (e.g. `admin.feedback.tsx`) can render charts in a consistent shell
 * without duplicating the layout.
 */
export function ChartCard({
	title,
	description,
	className,
	children,
}: {
	title: string;
	description: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Card className={cn("min-w-0 gap-2 py-4 sm:py-6", className)}>
			<CardHeader className="px-4 sm:px-6">
				<CardTitle className="text-base sm:text-lg">{title}</CardTitle>
				<p className="text-xs text-muted-foreground sm:text-sm">
					{description}
				</p>
			</CardHeader>
			<CardContent className="min-w-0 px-2 sm:px-6">{children}</CardContent>
		</Card>
	);
}

export function ChartSkeleton() {
	return <Skeleton className="h-60 w-full sm:h-72" />;
}

export function EmptyChart({ message }: { message?: string }) {
	return (
		<div className="flex h-44 items-center justify-center px-4 text-center text-xs text-muted-foreground sm:h-56 sm:text-sm">
			{message ?? "No data yet for this range."}
		</div>
	);
}

/** Format an ISO date string ("YYYY-MM-DD") as e.g. "May 7" — used as a
 * compact x-axis tick formatter on the daily series charts. */
export function shortDate(value: string): string {
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Verbose ISO date format used in chart tooltips. */
export function longDate(value: string): string {
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
