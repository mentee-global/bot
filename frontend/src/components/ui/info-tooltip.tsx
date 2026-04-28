import { Info } from "lucide-react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "#/lib/utils";

interface InfoTooltipProps {
	title?: string;
	children: ReactNode;
	className?: string;
	side?: "top" | "bottom" | "right" | "left";
}

/**
 * Info-icon that opens a labelled popover on hover, focus, or click. Built on
 * Radix HoverCard so the popup is rendered in a portal — that lets it escape
 * ancestors with `overflow: hidden` (e.g. table-card scroll containers, sticky
 * headers) which the previous absolute-positioned implementation could not.
 *
 * Hover/focus open via HoverCard's defaults; click toggles a sticky-open mode
 * so the popover stays visible while the admin reads the longer explanations.
 */
export function InfoTooltip({
	title,
	children,
	className,
	side = "top",
}: InfoTooltipProps) {
	const [stickyOpen, setStickyOpen] = useState(false);
	const [hoverOpen, setHoverOpen] = useState(false);
	const open = stickyOpen || hoverOpen;

	return (
		<HoverCardPrimitive.Root
			open={open}
			onOpenChange={(next) => {
				setHoverOpen(next);
				if (!next) setStickyOpen(false);
			}}
			openDelay={80}
			closeDelay={120}
		>
			<HoverCardPrimitive.Trigger asChild>
				<button
					type="button"
					aria-label={title ?? "More info"}
					aria-expanded={open}
					onClick={(e) => {
						e.preventDefault();
						setStickyOpen((v) => !v);
					}}
					className={cn(
						"inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]",
						className,
					)}
				>
					<Info size={14} aria-hidden="true" />
				</button>
			</HoverCardPrimitive.Trigger>
			<HoverCardPrimitive.Portal>
				<HoverCardPrimitive.Content
					side={side}
					align="start"
					sideOffset={6}
					collisionPadding={8}
					className="z-50 w-64 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3 text-left shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
				>
					{title ? (
						<p className="m-0 mb-1 text-xs font-semibold text-foreground">
							{title}
						</p>
					) : null}
					<div className="m-0 text-xs leading-relaxed text-muted-foreground">
						{children}
					</div>
				</HoverCardPrimitive.Content>
			</HoverCardPrimitive.Portal>
		</HoverCardPrimitive.Root>
	);
}
