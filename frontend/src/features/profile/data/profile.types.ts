/** Mirrors backend ProfileResponse (app/api/routes/profile.py).
 *
 * The CV is OCR'd to faithful Markdown (`cv_markdown`) which is injected into
 * every chat; `about_me` is free-text prose the mentee wants the bot to know. */
export interface ProfileResponse {
	has_cv: boolean;
	cv_document_id: string | null;
	cv_filename: string | null;
	cv_markdown: string | null;
	/** Credits debited to OCR the active CV (0 for local-decode formats). */
	cv_credits_charged: number;
	about_me: string | null;
	updated_at: string | null;
}
