import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearLoginAttempt,
	readLoginAttempt,
} from "#/features/auth/data/loginAttempt";

describe("loginAttempt cookie helpers", () => {
	beforeEach(() => {
		// jsdom carries cookies across tests; clear before each.
		document.cookie = "mentee_login_attempt=; Max-Age=0; path=/";
	});

	afterEach(() => {
		document.cookie = "mentee_login_attempt=; Max-Age=0; path=/";
	});

	it("returns null when the cookie is absent", () => {
		expect(readLoginAttempt()).toBeNull();
	});

	it("parses a numeric timestamp into a number", () => {
		document.cookie = "mentee_login_attempt=1747740000; path=/";
		expect(readLoginAttempt()).toBe(1747740000);
	});

	it("returns null when the cookie value is not a finite positive integer", () => {
		document.cookie = "mentee_login_attempt=not-a-number; path=/";
		expect(readLoginAttempt()).toBeNull();
	});

	it("returns null when the cookie value is zero or negative", () => {
		document.cookie = "mentee_login_attempt=0; path=/";
		expect(readLoginAttempt()).toBeNull();
	});

	it("ignores unrelated cookies sharing a prefix", () => {
		document.cookie = "mentee_login_attempt_other=999; path=/";
		expect(readLoginAttempt()).toBeNull();
	});

	it("clearLoginAttempt removes the cookie", () => {
		document.cookie = "mentee_login_attempt=1747740000; path=/";
		expect(readLoginAttempt()).toBe(1747740000);
		clearLoginAttempt();
		expect(readLoginAttempt()).toBeNull();
	});
});
