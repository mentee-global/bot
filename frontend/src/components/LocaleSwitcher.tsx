import { Check, ChevronDown, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale, locales, setLocale } from "#/paraglide/runtime";

type Locale = (typeof locales)[number];

const LOCALE_LABELS: Record<string, { name: string; native: string }> = {
	en: { name: "English", native: "English" },
	es: { name: "Spanish", native: "Español" },
	pt: { name: "Portuguese", native: "Português" },
	ar: { name: "Arabic", native: "العربية" },
	fr: { name: "French", native: "Français" },
	de: { name: "German", native: "Deutsch" },
	it: { name: "Italian", native: "Italiano" },
};

function labelFor(locale: string) {
	return (
		LOCALE_LABELS[locale] ?? { name: locale.toUpperCase(), native: locale }
	);
}

export default function ParaglideLocaleSwitcher() {
	const current = getLocale() as Locale;
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		function onPointer(e: MouseEvent) {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		window.addEventListener("mousedown", onPointer);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", onPointer);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const currentLabel = labelFor(current);

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={m.language_label()}
				className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 text-xs font-medium text-[var(--theme-primary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-elevated)]"
			>
				<Globe size={14} strokeWidth={2} aria-hidden="true" />
				<span className="font-semibold uppercase tracking-wider">
					{current}
				</span>
				<ChevronDown
					size={12}
					strokeWidth={2.5}
					className={cn(
						"text-[var(--theme-muted)] transition-transform",
						open && "rotate-180",
					)}
					aria-hidden="true"
				/>
				<span className="sr-only">
					{m.language_label()}: {currentLabel.name}
				</span>
			</button>

			{open && (
				<div
					role="listbox"
					aria-label={m.language_label()}
					className="absolute right-0 top-full z-50 mt-1.5 min-w-[10rem] overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] py-1 shadow-lg"
				>
					{locales.map((locale) => {
						const isActive = locale === current;
						const { name, native } = labelFor(locale);
						return (
							<button
								key={locale}
								type="button"
								role="option"
								lang={locale}
								aria-selected={isActive}
								onClick={() => {
									setLocale(locale);
									setOpen(false);
								}}
								className={cn(
									"flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
									isActive
										? "bg-[var(--theme-accent-soft)] text-[var(--theme-primary)]"
										: "text-[var(--theme-secondary)] hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)]",
								)}
							>
								<span className="flex flex-col">
									<span className="font-medium">{native}</span>
									<span className="text-[11px] text-[var(--theme-muted)]">
										{name}
									</span>
								</span>
								{isActive && (
									<Check
										size={14}
										strokeWidth={2.5}
										className="text-[var(--theme-accent-hover)]"
										aria-hidden="true"
									/>
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
