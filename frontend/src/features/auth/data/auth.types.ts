export type UserRole =
	| "mentee"
	| "mentor"
	| "admin"
	| "partner"
	| "guest"
	| "support"
	| "hub"
	| "moderator";

/** Education entry from the Mentee platform (mirrors backend MenteeEducation). */
export interface MenteeEducation {
	level: string;
	school: string;
	majors: string[];
	graduation_year?: number | null;
}

/** Read-only profile data sourced from Mentee's platform via OAuth.
 * Mirrors backend MenteeProfile — only the fields we surface on /profile. */
export interface MenteeProfile {
	country?: string | null;
	location?: string | null;
	languages: string[];
	age?: string | null;
	gender?: string | null;
	is_student?: boolean | null;
	education_level?: string | null;
	education: MenteeEducation[];
	interests: string[];
	topics: string[];
	biography?: string | null;
	work_state: string[];
	immigrant_status: string[];
	socially_engaged?: boolean | null;
	application_notes?: string | null;
	organization?: { name: string } | null;
	mentor?: { name: string; professional_title?: string | null } | null;
}

export interface User {
	id: string;
	email: string;
	name: string;
	role: UserRole;
	role_id: number;
	picture?: string | null;
	preferred_language?: string | null;
	timezone?: string | null;
	mentee_profile?: MenteeProfile | null;
}

export interface MeResponse {
	user: User;
}
