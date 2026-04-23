import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "#/lib/utils";

interface InfoTooltipProps {
	title?: string;
	children: ReactNode;
	className?: string;
	side?: "top" | "bottom" | "right";
}

/**
 * A small info-icon that opens a labelled popover on hover, focus, or click.
 *
 * Deliberately dependency-free: kept off @radix-ui/react-tooltip so this
 * page can render without the extra install. Hover + focus both open it,
 * click toggles stickily, Escape-on-blur closes. Good enough for admin
 * surfaces that don't need multi-layer positioning.
 */
export function InfoTooltip({
	title,
	children,
	className,
	side = "top",
}: InfoTooltipProps) {
	const [open, setOpen] = useState(false);
	const positionClasses =
		side === "bottom"
			? "top-full left-1/2 -translate-x-1/2 mt-2"
			: side === "right"
				? "left-full top-0 ml-2"
				: "bottom-full left-1/2 -translate-x-1/2 mb-2";

	return (
		<span className={cn("relative inline-flex", className)}>
			<button
				type="button"
				aria-label={title ?? "More info"}
				aria-expanded={open}
				onMouseEnter={() => setOpen(true)}
				onMouseLeave={() => setOpen(false)}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onClick={(e) => {
					e.preventDefault();
					setOpen((v) => !v);
				}}
				className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]"
			>
				<Info size={14} aria-hidden="true" />
			</button>
			{open ? (
				<div
					role="tooltip"
					className={cn(
						"pointer-events-none absolute z-50 w-64 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3 text-left shadow-lg",
						positionClasses,
					)}
				>
					{title ? (
						<p className="m-0 mb-1 text-xs font-semibold text-foreground">
							{title}
						</p>
					) : null}
					<div className="m-0 text-xs leading-relaxed text-muted-foreground">
						{children}
					</div>
				</div>
			) : null}
		</span>
	);
}
