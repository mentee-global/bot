import { afterEach, describe, expect, it, vi } from "vitest";
import { profileService } from "#/features/profile/data/profile.service";
import { api } from "#/lib/api/client";

vi.mock("#/lib/api/client", () => ({
	api: {
		get: vi.fn(() => Promise.resolve({})),
		put: vi.fn(() => Promise.resolve({})),
		upload: vi.fn(() => Promise.resolve({})),
		delete: vi.fn(() => Promise.resolve(undefined)),
	},
}));

describe("profileService", () => {
	afterEach(() => vi.clearAllMocks());

	it("fetches the profile from /api/profile", () => {
		profileService.get();
		expect(api.get).toHaveBeenCalledWith("/api/profile", undefined);
	});

	it("uploads a CV as multipart with purpose=profile_cv", () => {
		const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
		profileService.uploadCv(file);
		const [url, form] = (api.upload as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe("/api/documents");
		expect(form).toBeInstanceOf(FormData);
		expect((form as FormData).get("purpose")).toBe("profile_cv");
		expect((form as FormData).get("file")).toBe(file);
	});

	it("saves about-me to /api/profile/about", () => {
		profileService.saveAbout("Hello there");
		expect(api.put).toHaveBeenCalledWith("/api/profile/about", {
			about_me: "Hello there",
		});
	});

	it("removes a CV by document id", () => {
		profileService.removeCv("doc-123");
		expect(api.delete).toHaveBeenCalledWith("/api/documents/doc-123");
	});
});
