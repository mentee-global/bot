import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mentee.chat.pins.v1";

function readFromStorage(): Set<string> {
	if (typeof window === "undefined") return new Set();
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw);
		return new Set(
			Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [],
		);
	} catch {
		return new Set();
	}
}

function writeToStorage(pins: Set<string>) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...pins]));
	} catch {
		// quota / privacy mode — pins are best-effort.
	}
}

export function usePinnedThreads() {
	const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
		readFromStorage(),
	);

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key !== STORAGE_KEY) return;
			setPinnedIds(readFromStorage());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const togglePin = useCallback((threadId: string) => {
		setPinnedIds((prev) => {
			const next = new Set(prev);
			if (next.has(threadId)) next.delete(threadId);
			else next.add(threadId);
			writeToStorage(next);
			return next;
		});
	}, []);

	const removePin = useCallback((threadId: string) => {
		setPinnedIds((prev) => {
			if (!prev.has(threadId)) return prev;
			const next = new Set(prev);
			next.delete(threadId);
			writeToStorage(next);
			return next;
		});
	}, []);

	return { pinnedIds, togglePin, removePin };
}
