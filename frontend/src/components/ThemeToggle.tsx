import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") return "light";
	const stored = window.localStorage.getItem("theme");
	return stored === "dark" ? "dark" : "light";
}

function applyThemeMode(mode: ThemeMode) {
	const root = document.documentElement;
	root.classList.remove("light", "dark");
	root.classList.add(mode);
	root.setAttribute("data-theme", mode);
	root.style.colorScheme = mode;
}

export default function ThemeToggle() {
	const [mode, setMode] = useState<ThemeMode>("light");

	useEffect(() => {
		const initial = getInitialMode();
		setMode(initial);
		applyThemeMode(initial);
	}, []);

	function toggleMode() {
		const next: ThemeMode = mode === "light" ? "dark" : "light";
		setMode(next);
		applyThemeMode(next);
		window.localStorage.setItem("theme", next);
	}

	const label =
		mode === "light" ? "Switch to dark mode" : "Switch to light mode";
	const Icon = mode === "dark" ? Moon : Sun;

	return (
		<button
			type="button"
			onClick={toggleMode}
			aria-label={label}
			title={label}
			className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-primary)] transition-colors hover:border-[var(--theme-border-strong)] hover:bg-[var(--theme-surface-elevated)]"
		>
			<Icon size={16} strokeWidth={2} />
		</button>
	);
}
