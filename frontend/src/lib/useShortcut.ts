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

const isMac =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

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

export function isModKeyLabel(): string {
	return isMac ? "⌘" : "Ctrl";
}
