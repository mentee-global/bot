import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "mentee.chat.drafts.v1";

type DraftMap = Record<string, string>;

function readAll(): DraftMap {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: DraftMap = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (typeof v === "string") out[k] = v;
			}
			return out;
		}
	} catch {
		// fall through to empty
	}
	return {};
}

function writeAll(drafts: DraftMap) {
	if (typeof window === "undefined") return;
	try {
		const trimmed: DraftMap = {};
		for (const [k, v] of Object.entries(drafts)) {
			if (v.length > 0) trimmed[k] = v;
		}
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
	} catch {
		// ignore quota errors
	}
}

function keyFor(threadId: string | null | undefined): string {
	return threadId ?? "__new__";
}

export function clearAllDrafts() {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

export function useDraft(threadId: string | null | undefined) {
	const [drafts, setDrafts] = useState<DraftMap>(() => readAll());

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key !== STORAGE_KEY) return;
			setDrafts(readAll());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const k = keyFor(threadId);
	const value = drafts[k] ?? "";

	const setDraft = useCallback(
		(text: string) => {
			setDrafts((prev) => {
				if ((prev[k] ?? "") === text) return prev;
				const next = { ...prev };
				if (text.length === 0) delete next[k];
				else next[k] = text;
				writeAll(next);
				return next;
			});
		},
		[k],
	);

	const clearDraft = useCallback(() => {
		setDrafts((prev) => {
			if (!(k in prev)) return prev;
			const next = { ...prev };
			delete next[k];
			writeAll(next);
			return next;
		});
	}, [k]);

	return { value, setDraft, clearDraft };
}
