import type { PersonaPayload } from "#/features/admin/data/persona.types";
import { API_URL } from "#/lib/api/client";
import { ApiError } from "#/lib/api/errors";

export type StreamEvent =
	| { event: "meta"; data: string }
	| { event: "token"; data: string }
	| { event: "tool"; data: string }
	| { event: "done"; data: string }
	| { event: "suggestions"; data: string }
	| { event: "error"; data: string };

/**
 * POST to a server-sent-events endpoint and yield parsed events.
 *
 * The backend emits `event: <name>\ndata: <payload>\n\n` frames. This parser
 * tolerates multi-line data fields (concatenated with `\n`) and ignores
 * comment / heartbeat lines (starting with `:`).
 *
 * Errors surface to the caller:
 *  - `ApiError` on non-2xx responses (same contract as the `api.*` client).
 *  - Any other thrown error propagates — callers should fall back to the
 *    non-streaming POST endpoint.
 */
export async function* streamChatMessage(
	body: string,
	threadId?: string,
	signal?: AbortSignal,
	persona?: PersonaPayload,
): AsyncGenerator<StreamEvent, void, unknown> {
	const payload: Record<string, unknown> = { body };
	if (threadId) payload.thread_id = threadId;
	if (persona) payload.persona = persona;
	const response = await fetch(`${API_URL}/api/chat/messages/stream`, {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(payload),
		signal,
	});

	if (!response.ok) {
		let parsed: unknown = null;
		try {
			parsed = await response.json();
		} catch {
			/* empty */
		}
		throw new ApiError(response.status, parsed);
	}
	if (!response.body) {
		throw new Error("stream: response has no body");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const parsed = parseFrame(frame);
				if (parsed) yield parsed;
				boundary = buffer.indexOf("\n\n");
			}
		}
		// Flush anything left in the buffer.
		if (buffer.trim()) {
			const parsed = parseFrame(buffer);
			if (parsed) yield parsed;
		}
	} finally {
		reader.releaseLock();
	}
}

function parseFrame(frame: string): StreamEvent | null {
	let event: string | null = null;
	const dataLines: string[] = [];
	for (const raw of frame.split("\n")) {
		if (!raw || raw.startsWith(":")) continue;
		if (raw.startsWith("event: ")) {
			event = raw.slice("event: ".length).trim();
		} else if (raw.startsWith("data: ")) {
			dataLines.push(raw.slice("data: ".length));
		}
	}
	if (!event) return null;
	const data = dataLines.join("\n");
	if (
		event === "meta" ||
		event === "token" ||
		event === "tool" ||
		event === "done" ||
		event === "suggestions" ||
		event === "error"
	) {
		return { event, data };
	}
	return null;
}
