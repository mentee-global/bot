export type DocumentStatus = "pending" | "processing" | "ready" | "failed";

/** Mirrors backend DocumentResponse (app/api/routes/documents.py). */
export interface DocumentResponse {
	id: string;
	thread_id: string | null;
	purpose: string;
	filename: string;
	mime_type: string;
	size_bytes: number;
	status: DocumentStatus;
	summary: string | null;
	page_count: number | null;
	error_message: string | null;
	created_at: string;
	updated_at: string;
}

/** Allowed upload types — kept in sync with settings.allowed_upload_mimes. */
export const ALLOWED_UPLOAD_MIMES = [
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** Mirrors settings.max_upload_bytes (25 MiB). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
