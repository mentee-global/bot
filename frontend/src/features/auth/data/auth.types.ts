export type UserRole =
	| "mentee"
	| "mentor"
	| "admin"
	| "partner"
	| "guest"
	| "support"
	| "hub"
	| "moderator";

export interface User {
	id: string;
	email: string;
	name: string;
	role: UserRole;
	role_id: number;
	picture?: string | null;
	preferred_language?: string | null;
	timezone?: string | null;
}

export interface MeResponse {
	user: User;
}
