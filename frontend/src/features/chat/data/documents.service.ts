import type { DocumentResponse } from "#/features/chat/data/documents.types";
import { api } from "#/lib/api/client";

export const documentsService = {
	/** Upload a chat attachment scoped to a thread. Returns the document row
	 * with status "pending" — processing happens async; poll with `get`. */
	upload: (threadId: string, file: File, signal?: AbortSignal) => {
		const form = new FormData();
		form.append("file", file);
		form.append("purpose", "chat_attachment");
		form.append("thread_id", threadId);
		return api.upload<DocumentResponse>("/api/documents", form, signal);
	},
	get: (documentId: string, signal?: AbortSignal) =>
		api.get<DocumentResponse>(
			`/api/documents/${encodeURIComponent(documentId)}`,
			signal,
		),
	remove: (documentId: string) =>
		api.delete<void>(`/api/documents/${encodeURIComponent(documentId)}`),
};
