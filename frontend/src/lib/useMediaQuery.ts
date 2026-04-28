import { useEffect, useState } from "react";

export function useMediaQuery(query: string, fallback = false): boolean {
	const [matches, setMatches] = useState<boolean>(() => {
		if (typeof window === "undefined" || !window.matchMedia) return fallback;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mql = window.matchMedia(query);
		const onChange = () => setMatches(mql.matches);
		setMatches(mql.matches);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}

// Tailwind's `md` breakpoint — matches where the chat sidebar becomes inline
// and where keyboard shortcuts make sense (anyone on a touch-only device
// at this width is rare; the gate is mostly to avoid registering global
// listeners on phones).
export function useIsDesktop(): boolean {
	return useMediaQuery("(min-width: 768px)");
}
