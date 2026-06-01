import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { documentsService } from "#/features/chat/data/documents.service";
import {
	ALLOWED_UPLOAD_MIMES,
	type DocumentStatus,
	MAX_UPLOAD_BYTES,
} from "#/features/chat/data/documents.types";
import { ApiError } from "#/lib/api/errors";
import { m } from "#/paraglide/messages";

/** Client-side view of one attachment. `uploading` is local-only; the rest
 * mirror the backend document status. */
export interface Attachment {
	localId: string;
	documentId: string | null;
	filename: string;
	status: "uploading" | DocumentStatus;
	error?: string;
}

const TERMINAL: ReadonlySet<string> = new Set(["ready", "failed"]);
const POLL_MS = 1500;

let _seq = 0;
function nextLocalId(): string {
	_seq += 1;
	return `att-${_seq}-${performance.now()}`;
}

/**
 * Manages chat attachments for a thread: upload, poll until processing
 * settles, and remove. Attachments are thread-scoped on the backend, so the
 * agent picks them up via thread document context — nothing needs to ride on
 * the message send. Resets when the active thread changes.
 */
export function useThreadAttachments(threadId: string | null) {
	const [attachments, setAttachments] = useState<Attachment[]>([]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: clear the tray when the active thread changes — threadId is the trigger, not a body dependency.
	useEffect(() => {
		setAttachments([]);
	}, [threadId]);

	const addFiles = useCallback(
		(files: FileList | File[]) => {
			if (!threadId) return;
			for (const file of Array.from(files)) {
				if (!ALLOWED_UPLOAD_MIMES.includes(file.type as never)) {
					toast.error(m.chat_attachment_error_type());
					continue;
				}
				if (file.size > MAX_UPLOAD_BYTES) {
					toast.error(m.chat_attachment_error_too_large());
					continue;
				}
				const localId = nextLocalId();
				setAttachments((prev) => [
					...prev,
					{
						localId,
						documentId: null,
						filename: file.name,
						status: "uploading",
					},
				]);
				documentsService
					.upload(threadId, file)
					.then((doc) => {
						setAttachments((prev) =>
							prev.map((a) =>
								a.localId === localId
									? { ...a, documentId: doc.id, status: doc.status }
									: a,
							),
						);
					})
					.catch((err) => {
						const message =
							err instanceof ApiError && err.status === 413
								? m.chat_attachment_error_too_large()
								: m.chat_attachment_error_upload();
						toast.error(message);
						setAttachments((prev) =>
							prev.map((a) =>
								a.localId === localId
									? { ...a, status: "failed", error: message }
									: a,
							),
						);
					});
			}
		},
		[threadId],
	);

	const remove = useCallback((localId: string) => {
		setAttachments((prev) => {
			const target = prev.find((a) => a.localId === localId);
			if (target?.documentId) {
				// Best-effort backend cleanup; UI removes immediately.
				void documentsService.remove(target.documentId).catch(() => {});
			}
			return prev.filter((a) => a.localId !== localId);
		});
	}, []);

	// Poll documents that are still being processed until they settle.
	useEffect(() => {
		const inFlight = attachments.filter(
			(a) => a.documentId && !TERMINAL.has(a.status),
		);
		if (inFlight.length === 0) return;
		const timer = setInterval(() => {
			for (const a of inFlight) {
				if (!a.documentId) continue;
				documentsService
					.get(a.documentId)
					.then((doc) => {
						setAttachments((prev) =>
							prev.map((x) =>
								x.localId === a.localId
									? {
											...x,
											status: doc.status,
											error: doc.error_message ?? undefined,
										}
									: x,
							),
						);
					})
					.catch(() => {
						/* transient — keep polling */
					});
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [attachments]);

	return { attachments, addFiles, remove };
}
