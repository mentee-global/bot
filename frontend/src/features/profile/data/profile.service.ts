import { queryOptions } from "@tanstack/react-query";
import type { DocumentResponse } from "#/features/chat/data/documents.types";
import type {
	ProfileResponse,
	ResumeData,
} from "#/features/profile/data/profile.types";
import { api } from "#/lib/api/client";

export const profileService = {
	get: (signal?: AbortSignal) =>
		api.get<ProfileResponse>("/api/profile", signal),

	/** Upload a CV. Processing is async — poll `getDocument` for status, then
	 * refetch the profile for the extracted draft. */
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

	/** Save + confirm the (edited) CV — gates injection into chats. */
	saveCv: (data: ResumeData) =>
		api.put<ProfileResponse>("/api/profile/cv", data),
};

export const profileQueryOptions = queryOptions({
	queryKey: ["profile"] as const,
	queryFn: ({ signal }) => profileService.get(signal),
});
