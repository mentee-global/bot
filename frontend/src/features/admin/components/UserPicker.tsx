import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { AdminUserSummary } from "#/features/admin/data/admin.types";
import { useAdminUsersQuery } from "#/features/admin/hooks/useAdmin";
import { useDebouncedValue } from "#/lib/useDebouncedValue";
import { cn } from "#/lib/utils";

export interface UserPickerProps {
	value: string | null;
	onChange: (userId: string | null, user: AdminUserSummary | null) => void;
	excludeUserId?: string;
	placeholder?: string;
	disabled?: boolean;
	className?: string;
}

/**
 * Searchable picker over the admin users list. Backed by /api/admin/users so
 * non-technical admins can find a destination user by name or email instead
 * of pasting a UUID. Search runs server-side (debounced) so it scales beyond
 * a single page of results.
 */
export function UserPicker({
	value,
	onChange,
	excludeUserId,
	placeholder = "Search by name or email…",
	disabled = false,
	className,
}: UserPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const triggerId = useId();

	const debounced = useDebouncedValue(query.trim(), 200);
	const list = useAdminUsersQuery({
		query: debounced || undefined,
	});

	// We rely on the same paginated list to look up the current selection's
	// label. The first 25 mentees + admins almost always include any user the
	// admin recently picked; if not, we degrade to the bare ID.
	const allRows = list.data?.users ?? [];
	const filtered = allRows.filter((u) => u.user_id !== excludeUserId);
	const selected = allRows.find((u) => u.user_id === value) ?? null;

	useEffect(() => {
		if (!open) {
			setQuery("");
			setActiveIndex(0);
		} else {
			queueMicrotask(() => inputRef.current?.focus());
		}
	}, [open]);

	useEffect(() => {
		setActiveIndex(0);
	}, []);

	function commit(user: AdminUserSummary) {
		onChange(user.user_id, user);
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
			const u = filtered[activeIndex];
			if (u) commit(u);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	}

	const triggerLabel = selected
		? selected.name || selected.email
		: value
			? "Loading…"
			: placeholder;

	return (
		<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
			<PopoverPrimitive.Trigger asChild>
				<button
					id={triggerId}
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
					<span className="flex min-w-0 flex-col text-left">
						<span className="truncate">{triggerLabel}</span>
						{selected?.name && selected.email ? (
							<span className="truncate text-xs text-muted-foreground">
								{selected.email}
							</span>
						) : null}
					</span>
					<div className="ml-2 flex shrink-0 items-center gap-1 text-muted-foreground">
						{selected ? (
							<button
								type="button"
								aria-label="Clear selection"
								className="rounded p-0.5 transition hover:bg-muted hover:text-foreground"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									onChange(null, null);
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
					className="z-50 w-(--radix-popover-trigger-width) min-w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
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
							placeholder="Search by name or email"
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</div>
					<div className="max-h-72 overflow-y-auto py-1">
						{list.isPending ? (
							<p className="px-3 py-4 text-center text-sm text-muted-foreground">
								Loading users…
							</p>
						) : list.isError ? (
							<p className="px-3 py-4 text-center text-sm text-destructive">
								{list.error.message}
							</p>
						) : filtered.length === 0 ? (
							<p className="px-3 py-4 text-center text-sm text-muted-foreground">
								{debounced ? `No users match "${debounced}".` : "No users."}
							</p>
						) : (
							filtered.map((u, idx) => {
								const isSelected = u.user_id === value;
								const isActive = idx === activeIndex;
								return (
									<button
										key={u.user_id}
										type="button"
										onMouseEnter={() => setActiveIndex(idx)}
										onClick={() => commit(u)}
										className={cn(
											"flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm outline-none",
											isActive && "bg-accent text-accent-foreground",
										)}
									>
										<span className="flex min-w-0 flex-col">
											<span className="truncate font-medium">
												{u.name || u.email}
											</span>
											<span className="truncate text-xs text-muted-foreground">
												{u.name ? u.email : u.role}
											</span>
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
