import type { ComponentProps } from "react";
import { cn } from "#/lib/utils";

/**
 * Animated placeholder block — drop in wherever a plain-text "Loading…" used
 * to live. Shape the skeleton with tailwind classes on the caller.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			{...props}
			aria-hidden="true"
			className={cn(
				"animate-pulse rounded-md bg-[var(--theme-border)]",
				className,
			)}
		/>
	);
}
