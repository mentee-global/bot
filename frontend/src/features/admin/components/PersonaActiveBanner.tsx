import { Sparkles, X } from "lucide-react";
import { Button } from "#/components/ui/button";
import {
	personaStore,
	usePersonaState,
} from "#/features/admin/hooks/usePersonaStore";

/**
 * Subtle banner shown above the message list when an admin has an active
 * "Test persona" override. Reminds them that the agent is *not* responding
 * to their own profile, and offers a one-click way to disable.
 */
export function PersonaActiveBanner({ onEdit }: { onEdit: () => void }) {
	const { active, data } = usePersonaState();
	if (!active || Object.keys(data).length === 0) return null;
	const summary = summarizePersona(data);
	return (
		<div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-2 text-sm">
			<Sparkles className="size-4 shrink-0 text-[var(--theme-accent)]" />
			<span className="min-w-0 flex-1 text-[var(--theme-primary)]">
				<strong className="font-semibold">Testing as:</strong> {summary}
			</span>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2"
				onClick={onEdit}
			>
				Edit
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7 px-2"
				onClick={() => personaStore.setActive(false)}
				aria-label="Disable test persona"
			>
				<X className="size-4" />
			</Button>
		</div>
	);
}

function summarizePersona(data: Record<string, unknown>): string {
	const parts: string[] = [];
	const name = typeof data.name === "string" ? data.name : null;
	const role = typeof data.role === "string" ? data.role : null;
	if (name) parts.push(name);
	if (role) parts.push(`(${role})`);
	const profile =
		data.mentee_profile && typeof data.mentee_profile === "object"
			? (data.mentee_profile as Record<string, unknown>)
			: null;
	if (profile) {
		const country = typeof profile.country === "string" ? profile.country : "";
		const location =
			typeof profile.location === "string" ? profile.location : "";
		const place = [location, country].filter(Boolean).join(", ");
		if (place) parts.push(`· ${place}`);
		if (Array.isArray(profile.interests) && profile.interests.length > 0) {
			const tags = profile.interests
				.filter((v): v is string => typeof v === "string")
				.slice(0, 3)
				.join(", ");
			if (tags) parts.push(`· ${tags}`);
		}
	}
	return parts.length > 0 ? parts.join(" ") : "(empty)";
}
