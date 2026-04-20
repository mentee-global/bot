import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/**
 * Accessible modal built on Radix UI primitives.
 *
 * Keep the API thin — consumers wire their own <Dialog> tree:
 *   <Dialog open={...} onOpenChange={...}>
 *     <DialogContent>
 *       <DialogTitle>…</DialogTitle>
 *       <DialogDescription>…</DialogDescription>
 *       …
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * Never use window.alert / window.confirm. Use this.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
	className,
	children,
	...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay
				className={cn(
					"fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
					"data-[state=open]:animate-in data-[state=open]:fade-in-0",
					"data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
				)}
			/>
			<DialogPrimitive.Content
				{...props}
				className={cn(
					"fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2",
					"rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-5 shadow-2xl",
					"focus:outline-none",
					"data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
					"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
					className,
				)}
			>
				{children}
				<DialogPrimitive.Close
					aria-label="Close"
					className="absolute right-3 top-3 rounded-md p-1 text-[var(--theme-muted)] transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)]"
				>
					<X className="size-4" />
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogTitle({
	className,
	...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			{...props}
			className={cn(
				"text-base font-semibold text-[var(--theme-primary)]",
				className,
			)}
		/>
	);
}

export function DialogDescription({
	className,
	...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			{...props}
			className={cn("mt-1 text-sm text-[var(--theme-secondary)]", className)}
		/>
	);
}

export function DialogFooter({ children }: { children: ReactNode }) {
	return (
		<div className="mt-5 flex items-center justify-end gap-2">{children}</div>
	);
}
