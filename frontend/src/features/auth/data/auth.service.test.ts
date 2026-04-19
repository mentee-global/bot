import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authService } from "#/features/auth/data/auth.service";
import { API_URL } from "#/lib/api/client";

describe("authService.startLogin", () => {
	let hrefValue = "";

	beforeEach(() => {
		hrefValue = "";
		Object.defineProperty(window, "location", {
			writable: true,
			value: {
				get href() {
					return hrefValue;
				},
				set href(value: string) {
					hrefValue = value;
				},
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("redirects to the backend login endpoint with no query when called bare", () => {
		authService.startLogin();
		expect(hrefValue).toBe(`${API_URL}/api/auth/login`);
	});

	it("appends an URL-encoded redirect_to when supplied", () => {
		authService.startLogin({ redirectTo: "/chat" });
		expect(hrefValue).toBe(
			`${API_URL}/api/auth/login?redirect_to=%2Fchat`,
		);
	});

	it("encodes characters that would otherwise break the query string", () => {
		authService.startLogin({ redirectTo: "/chat?foo=bar&baz=qux" });
		expect(hrefValue).toContain(
			"redirect_to=%2Fchat%3Ffoo%3Dbar%26baz%3Dqux",
		);
	});
});
