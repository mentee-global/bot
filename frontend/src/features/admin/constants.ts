// Allowed role filter values. Mirrors ROLE_NAMES on Mentee
// (mentee/backend/api/views/oauth.py) so the dropdown stays in sync with the
// roles that can actually show up in the `role` claim.
export const ROLE_OPTIONS = [
	"admin",
	"mentor",
	"mentee",
	"partner",
	"guest",
	"support",
	"hub",
	"moderator",
] as const;

export const ROLE_ALL = "__all__";

export function parseRoleFromSearch(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const lower = raw.toLowerCase();
	return ROLE_OPTIONS.includes(lower as never) ? lower : undefined;
}

export function parsePageFromSearch(raw: unknown): number | undefined {
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string"
				? Number.parseInt(raw, 10)
				: undefined;
	return n !== undefined && Number.isFinite(n) && n > 1 ? n : undefined;
}

export function parseStringFromSearch(raw: unknown): string | undefined {
	return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
