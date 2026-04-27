"use client";

import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "#/lib/utils";

export interface SelectOption {
	value: string;
	label: string;
	hint?: string;
}

interface SearchableSelectProps {
	id?: string;
	value: string | null | undefined;
	onChange: (next: string | null) => void;
	options: SelectOption[];
	placeholder?: string;
	searchPlaceholder?: string;
	emptyText?: string;
	clearable?: boolean;
	disabled?: boolean;
	className?: string;
}

/**
 * Lightweight combobox: a button that opens a popover with a fuzzy-filtered
 * option list. Built on top of Radix Popover (already a dep) so no new
 * package is required. Kept smaller than cmdk on purpose — covers the
 * "long, searchable list of strings" cases (timezones, languages, countries)
 * without becoming a generic command palette.
 */
export function SearchableSelect({
	id,
	value,
	onChange,
	options,
	placeholder = "Select…",
	searchPlaceholder = "Search…",
	emptyText = "No results",
	clearable = true,
	disabled = false,
	className,
}: SearchableSelectProps) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const [activeIndex, setActiveIndex] = React.useState(0);
	const listRef = React.useRef<HTMLDivElement | null>(null);
	const inputRef = React.useRef<HTMLInputElement | null>(null);

	const filtered = React.useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return options;
		return options.filter(
			(o) =>
				o.label.toLowerCase().includes(q) ||
				o.value.toLowerCase().includes(q) ||
				o.hint?.toLowerCase().includes(q),
		);
	}, [options, query]);

	React.useEffect(() => {
		if (!open) {
			setQuery("");
		} else {
			// Defer focus until the popover content has actually mounted.
			queueMicrotask(() => inputRef.current?.focus());
		}
	}, [open]);

	const selected = options.find((o) => o.value === value) ?? null;

	function commit(next: string | null) {
		onChange(next);
		setOpen(false);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const opt = filtered[activeIndex];
			if (opt) commit(opt.value);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	}

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<button
					id={id}
					type="button"
					disabled={disabled}
					aria-expanded={open}
					className={cn(
						"flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow]",
						"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
						"disabled:cursor-not-allowed disabled:opacity-50",
						!selected && "text-muted-foreground",
						className,
					)}
				>
					<span className="truncate">
						{selected ? selected.label : placeholder}
					</span>
					<div className="ml-2 flex shrink-0 items-center gap-1 text-muted-foreground">
						{clearable && selected ? (
							<button
								type="button"
								aria-label="Clear"
								className="rounded p-0.5 transition hover:bg-muted hover:text-foreground"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									onChange(null);
								}}
							>
								<X className="size-3.5" />
							</button>
						) : null}
						<ChevronsUpDown className="size-3.5 opacity-60" />
					</div>
				</button>
			</PopoverPrimitive.Trigger>
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Content
					align="start"
					sideOffset={4}
					className="z-50 w-(--radix-popover-trigger-width) min-w-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
				>
					<div className="flex items-center gap-2 border-b px-3 py-2">
						<Search className="size-3.5 text-muted-foreground" />
						<input
							ref={inputRef}
							type="text"
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setActiveIndex(0);
							}}
							onKeyDown={handleKeyDown}
							placeholder={searchPlaceholder}
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</div>
					<div ref={listRef} className="max-h-64 overflow-y-auto py-1">
						{filtered.length === 0 ? (
							<p className="px-3 py-4 text-center text-sm text-muted-foreground">
								{emptyText}
							</p>
						) : (
							filtered.map((opt, idx) => {
								const isSelected = opt.value === value;
								const isActive = idx === activeIndex;
								return (
									<button
										key={opt.value}
										type="button"
										onMouseEnter={() => setActiveIndex(idx)}
										onClick={() => commit(opt.value)}
										className={cn(
											"flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm outline-none",
											isActive && "bg-accent text-accent-foreground",
										)}
									>
										<span className="flex min-w-0 flex-col">
											<span className="truncate">{opt.label}</span>
											{opt.hint ? (
												<span className="truncate text-xs text-muted-foreground">
													{opt.hint}
												</span>
											) : null}
										</span>
										{isSelected ? (
											<Check className="size-3.5 shrink-0 text-foreground" />
										) : null}
									</button>
								);
							})
						)}
					</div>
				</PopoverPrimitive.Content>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}
