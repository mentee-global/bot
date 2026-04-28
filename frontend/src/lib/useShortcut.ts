import { useEffect } from "react";

interface ShortcutOptions {
	when?: boolean;
	allowInInput?: boolean;
	preventDefault?: boolean;
}

interface ParsedShortcut {
	key: string;
	mod: boolean;
	shift: boolean;
	alt: boolean;
}

function parse(combo: string): ParsedShortcut {
	const parts = combo
		.toLowerCase()
		.split("+")
		.map((p) => p.trim());
	let key = "";
	let mod = false;
	let shift = false;
	let alt = false;
	for (const p of parts) {
		if (p === "mod" || p === "cmd" || p === "ctrl") mod = true;
		else if (p === "shift") shift = true;
		else if (p === "alt" || p === "option") alt = true;
		else key = p;
	}
	return { key, mod, shift, alt };
}

// `navigator.platform` is deprecated and reports "MacIntel" on iPads in
// desktop-mode Safari. Prefer the modern `userAgentData.platform` and fall
// back to userAgent — Cmd is the right key for any Apple-keyboard target,
// including iPad with an external keyboard.
function detectIsMac(): boolean {
	if (typeof navigator === "undefined") return false;
	const uad = (
		navigator as Navigator & { userAgentData?: { platform?: string } }
	).userAgentData;
	if (uad?.platform) return /mac/i.test(uad.platform);
	return /mac/i.test(navigator.userAgent);
}

const isMac = detectIsMac();

function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function matches(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
	const modKey = isMac ? e.metaKey : e.ctrlKey;
	if (parsed.mod !== modKey) return false;
	if (parsed.shift !== e.shiftKey) return false;
	if (parsed.alt !== e.altKey) return false;
	const k = e.key.toLowerCase();
	if (parsed.key === "?" && k === "/" && e.shiftKey) return true;
	return k === parsed.key;
}

export function useShortcut(
	combo: string | string[],
	handler: (e: KeyboardEvent) => void,
	options: ShortcutOptions = {},
) {
	const { when = true, allowInInput = false, preventDefault = true } = options;

	useEffect(() => {
		if (!when) return;
		const combos = Array.isArray(combo) ? combo : [combo];
		const parsedList = combos.map(parse);

		const onKey = (e: KeyboardEvent) => {
			if (!allowInInput && isEditable(e.target)) return;
			for (const parsed of parsedList) {
				if (matches(e, parsed)) {
					if (preventDefault) e.preventDefault();
					handler(e);
					return;
				}
			}
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [combo, handler, when, allowInInput, preventDefault]);
}

// Word labels read clearly on every keyboard. Windows/Linux machines have
// no Command key, so we show "Ctrl" there; Mac users see "Cmd" (matching
// what's printed on the physical key) instead of the ⌘ glyph that newcomers
// don't always recognize.
export function isModKeyLabel(): string {
	return isMac ? "Cmd" : "Ctrl";
}
