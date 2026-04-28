// Roles that can interact with the bot today: admins (manage the platform)
// and mentees (chat with the mentor). Other Mentee roles exist but the bot
// doesn't surface them, so we don't expose them as filters either. Re-add
// entries here when those audiences come online.
export const ROLE_OPTIONS = ["admin", "mentee"] as const;

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
