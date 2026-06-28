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
	/** Credits debited to OCR this document (CVs); 0 for chat attachments. */
	ocr_credits_charged: number;
	created_at: string;
	updated_at: string;
}

/** Allowed upload types — kept in sync with settings.allowed_upload_mimes.
 * Images go through gpt-5.4 vision OCR on the backend. */
export const ALLOWED_UPLOAD_MIMES = [
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"image/png",
	"image/jpeg",
	"image/webp",
] as const;

/** Mirrors settings.max_upload_bytes (25 MiB) — generic chat attachments. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Mirrors settings.max_cv_upload_bytes (10 MiB) — CV uploads are capped tighter. */
export const MAX_CV_BYTES = 10 * 1024 * 1024;
