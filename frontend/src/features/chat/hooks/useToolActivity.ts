import { useSyncExternalStore } from "react";
import type { ToolActivity } from "#/features/chat/data/chat.types";

type Listener = () => void;

const EMPTY: readonly ToolActivity[] = Object.freeze([]);

/**
 * Tiny global store for "what tools is the mentor currently running?".
 *
 * Stream events aren't part of the persisted thread data, so they don't belong
 * in TanStack Query's cache. We keep them in a useSyncExternalStore-friendly
 * singleton, indexed by assistant_message_id so the right chip row shows up
 * with the right streaming bubble.
 *
 * IMPORTANT: `list()` must return a cached array reference — useSyncExternalStore
 * runs `getSnapshot` on every render, and any new reference is treated as a
 * store change, which would infinite-loop the renderer (React error #185).
 */
class ToolActivityStore {
	private byMessage = new Map<string, Map<string, ToolActivity>>();
	private snapshots = new Map<string, readonly ToolActivity[]>();
	private listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit() {
		for (const l of this.listeners) l();
	}

	private invalidate(messageId: string): void {
		this.snapshots.delete(messageId);
	}

	start(messageId: string, activity: Omit<ToolActivity, "status">): void {
		const per = this.byMessage.get(messageId) ?? new Map();
		per.set(activity.tool_call_id, { ...activity, status: "running" });
		this.byMessage.set(messageId, per);
		this.invalidate(messageId);
		this.emit();
	}

	end(
		messageId: string,
		tool_call_id: string,
		outcome?: ToolActivity["outcome"],
	): void {
		const per = this.byMessage.get(messageId);
		if (!per) return;
		const existing = per.get(tool_call_id);
		if (!existing) return;
		per.set(tool_call_id, { ...existing, status: "done", outcome });
		this.byMessage.set(messageId, per);
		this.invalidate(messageId);
		this.emit();
	}

	clearMessage(messageId: string): void {
		const hadData = this.byMessage.delete(messageId);
		const hadSnapshot = this.snapshots.delete(messageId);
		if (hadData || hadSnapshot) this.emit();
	}

	list(messageId: string): readonly ToolActivity[] {
		const cached = this.snapshots.get(messageId);
		if (cached) return cached;
		const per = this.byMessage.get(messageId);
		const snapshot: readonly ToolActivity[] = per
			? Object.freeze(Array.from(per.values()))
			: EMPTY;
		this.snapshots.set(messageId, snapshot);
		return snapshot;
	}
}

export const toolActivityStore = new ToolActivityStore();

export function useToolActivityForMessage(
	messageId: string | undefined,
): readonly ToolActivity[] {
	return useSyncExternalStore(
		(listener) => toolActivityStore.subscribe(listener),
		() => (messageId ? toolActivityStore.list(messageId) : EMPTY),
		() => EMPTY,
	);
}
