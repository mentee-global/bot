import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { documentsService } from "#/features/chat/data/documents.service";
import {
	ALLOWED_UPLOAD_MIMES,
	type DocumentStatus,
	MAX_UPLOAD_BYTES,
} from "#/features/chat/data/documents.types";
import { ApiError } from "#/lib/api/errors";
import { m } from "#/paraglide/messages";

/** `staged` = picked but not yet uploaded; the rest mirror backend status. */
export type StagedStatus = "staged" | "uploading" | DocumentStatus;

export interface StagedAttachment {
	localId: string;
	file: File;
	filename: string;
	status: StagedStatus;
	documentId?: string;
	error?: string;
}

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

let _seq = 0;
function nextLocalId(): string {
	_seq += 1;
	return `att-${_seq}-${performance.now()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Client-side attachment staging. Files are held in memory and only uploaded
 * at send time via `commit(threadId)`, so:
 *   - nothing hits the backend until the user actually sends (no orphan
 *     threads, no upload-without-a-question), and
 *   - a file can be attached before the thread exists.
 * `commit` uploads each staged file and polls until processing settles, so the
 * agent sees the document on the very message it was attached to.
 */
export function useStagedAttachments() {
	const [staged, setStaged] = useState<StagedAttachment[]>([]);
	const stagedRef = useRef(staged);
	stagedRef.current = staged;

	const patch = useCallback(
		(localId: string, next: Partial<StagedAttachment>) => {
			setStaged((prev) =>
				prev.map((a) => (a.localId === localId ? { ...a, ...next } : a)),
			);
		},
		[],
	);

	const addFiles = useCallback((files: FileList | File[]) => {
		for (const file of Array.from(files)) {
			if (!ALLOWED_UPLOAD_MIMES.includes(file.type as never)) {
				toast.error(m.chat_attachment_error_type());
				continue;
			}
			if (file.size > MAX_UPLOAD_BYTES) {
				toast.error(m.chat_attachment_error_too_large());
				continue;
			}
			setStaged((prev) => [
				...prev,
				{
					localId: nextLocalId(),
					file,
					filename: file.name,
					status: "staged",
				},
			]);
		}
	}, []);

	const remove = useCallback((localId: string) => {
		setStaged((prev) => {
			const target = prev.find((a) => a.localId === localId);
			// If it was already uploaded (mid/post-commit), best-effort cleanup.
			if (target?.documentId) {
				void documentsService.remove(target.documentId).catch(() => {});
			}
			return prev.filter((a) => a.localId !== localId);
		});
	}, []);

	const clear = useCallback(() => setStaged([]), []);

	/**
	 * Upload every still-staged (or previously-failed) file to `threadId` and
	 * wait until each settles. Returns true only if all reached "ready".
	 */
	const commit = useCallback(
		async (threadId: string): Promise<boolean> => {
			const items = stagedRef.current.filter(
				(a) => a.status === "staged" || a.status === "failed",
			);
			let allReady = true;
			await Promise.all(
				items.map(async (item) => {
					try {
						patch(item.localId, { status: "uploading", error: undefined });
						const doc = await documentsService.upload(threadId, item.file);
						patch(item.localId, { status: doc.status, documentId: doc.id });
						let status: DocumentStatus = doc.status;
						const deadline = performance.now() + POLL_TIMEOUT_MS;
						while (
							status !== "ready" &&
							status !== "failed" &&
							performance.now() < deadline
						) {
							await sleep(POLL_MS);
							const cur = await documentsService.get(doc.id);
							status = cur.status;
							patch(item.localId, {
								status,
								error: cur.error_message ?? undefined,
							});
						}
						if (status !== "ready") allReady = false;
					} catch (err) {
						allReady = false;
						const message =
							err instanceof ApiError && err.status === 413
								? m.chat_attachment_error_too_large()
								: m.chat_attachment_error_upload();
						patch(item.localId, { status: "failed", error: message });
						toast.error(message);
					}
				}),
			);
			return allReady;
		},
		[patch],
	);

	return { staged, addFiles, remove, clear, commit };
}
