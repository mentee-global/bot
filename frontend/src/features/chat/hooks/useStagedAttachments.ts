import { useCallback, useState } from "react";
import { toast } from "sonner";
import { documentsService } from "#/features/chat/data/documents.service";
import {
	ALLOWED_UPLOAD_MIMES,
	type DocumentStatus,
	MAX_UPLOAD_BYTES,
} from "#/features/chat/data/documents.types";
import { m } from "#/paraglide/messages";

export interface StagedAttachment {
	localId: string;
	file: File;
	filename: string;
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
 * Composer-side attachment staging. Files are held in memory until send; on
 * send the caller grabs `staged` (for display + the File list), clears, and
 * runs `commit(threadId, files)` in the background to upload + wait for each to
 * process. Nothing hits the backend until send → no orphan threads, no upload
 * without a question.
 */
export function useStagedAttachments() {
	const [staged, setStaged] = useState<StagedAttachment[]>([]);

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
				{ localId: nextLocalId(), file, filename: file.name },
			]);
		}
	}, []);

	const remove = useCallback((localId: string) => {
		setStaged((prev) => prev.filter((a) => a.localId !== localId));
	}, []);

	const clear = useCallback(() => setStaged([]), []);

	/** Upload the given files to `threadId` and wait until each settles.
	 * Returns true only if all reached "ready". Independent of `staged` state
	 * so the composer can clear immediately on send. */
	const commit = useCallback(
		async (threadId: string, files: File[]): Promise<boolean> => {
			let allReady = true;
			await Promise.all(
				files.map(async (file) => {
					try {
						const doc = await documentsService.upload(threadId, file);
						let status: DocumentStatus = doc.status;
						const deadline = performance.now() + POLL_TIMEOUT_MS;
						while (
							status !== "ready" &&
							status !== "failed" &&
							performance.now() < deadline
						) {
							await sleep(POLL_MS);
							status = (await documentsService.get(doc.id)).status;
						}
						if (status !== "ready") allReady = false;
					} catch {
						allReady = false;
						toast.error(m.chat_attachment_error_upload());
					}
				}),
			);
			return allReady;
		},
		[],
	);

	return { staged, addFiles, remove, clear, commit };
}
