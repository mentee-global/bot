import { useSyncExternalStore } from "react";
import type { ToolActivity } from "#/features/chat/data/chat.types";

type Listener = () => void;

/**
 * Tiny global store for "what tools is the mentor currently running?".
 *
 * Stream events aren't part of the persisted thread data, so they don't belong
 * in TanStack Query's cache. We keep them in a useSyncExternalStore-friendly
 * singleton, indexed by assistant_message_id so the right chip row shows up
 * with the right streaming bubble.
 */
class ToolActivityStore {
	private byMessage = new Map<string, Map<string, ToolActivity>>();
	private listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit() {
		for (const l of this.listeners) l();
	}

	start(messageId: string, activity: Omit<ToolActivity, "status">): void {
		const per = this.byMessage.get(messageId) ?? new Map();
		per.set(activity.tool_call_id, { ...activity, status: "running" });
		this.byMessage.set(messageId, per);
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
		this.emit();
	}

	clearMessage(messageId: string): void {
		if (!this.byMessage.delete(messageId)) return;
		this.emit();
	}

	list(messageId: string): ToolActivity[] {
		const per = this.byMessage.get(messageId);
		if (!per) return [];
		return Array.from(per.values());
	}
}

export const toolActivityStore = new ToolActivityStore();

const emptyList: ToolActivity[] = [];

export function useToolActivityForMessage(
	messageId: string | undefined,
): ToolActivity[] {
	return useSyncExternalStore(
		(listener) => toolActivityStore.subscribe(listener),
		() => (messageId ? toolActivityStore.list(messageId) : emptyList),
		() => emptyList,
	);
}
