import { queryOptions } from "@tanstack/react-query";
import type { DocumentResponse } from "#/features/chat/data/documents.types";
import type { ProfileResponse } from "#/features/profile/data/profile.types";
import { api } from "#/lib/api/client";

export const profileService = {
	get: (signal?: AbortSignal) =>
		api.get<ProfileResponse>("/api/profile", signal),

	/** Upload a CV. OCR is async — poll `getDocument` for status, then refetch
	 * the profile for the transcription. The CV activates automatically. */
	uploadCv: (file: File, signal?: AbortSignal) => {
		const form = new FormData();
		form.append("file", file);
		form.append("purpose", "profile_cv");
		return api.upload<DocumentResponse>("/api/documents", form, signal);
	},

	getDocument: (documentId: string, signal?: AbortSignal) =>
		api.get<DocumentResponse>(
			`/api/documents/${encodeURIComponent(documentId)}`,
			signal,
		),

	/** Remove the active CV document (un-injects it from chats). */
	removeCv: (documentId: string) =>
		api.delete<void>(`/api/documents/${encodeURIComponent(documentId)}`),

	/** Save the free-text "about me" prose (injected into every chat). */
	saveAbout: (aboutMe: string) =>
		api.put<ProfileResponse>("/api/profile/about", { about_me: aboutMe }),
};

export const profileQueryOptions = queryOptions({
	queryKey: ["profile"] as const,
	queryFn: ({ signal }) => profileService.get(signal),
});
