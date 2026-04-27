import { useSyncExternalStore } from "react";
import type { PersonaPayload } from "#/features/admin/data/persona.types";

/**
 * Global "Test persona" store — admin-only override of the agent's user
 * context. Persisted to localStorage so flipping between threads or
 * reloading the page keeps the active persona.
 *
 * `data` is the form's working draft; `active` controls whether outgoing
 * chat requests attach the persona to their payload. Saving the form
 * promotes the draft to active; "Disable" toggles `active` off without
 * losing the values so the admin can re-enable later.
 */

const STORAGE_KEY = "menteebot.adminPersona.v1";

interface PersistedState {
	active: boolean;
	data: PersonaPayload;
}

const EMPTY_STATE: PersistedState = Object.freeze({
	active: false,
	data: {},
});

type Listener = () => void;

class PersonaStore {
	private state: PersistedState = EMPTY_STATE;
	private listeners = new Set<Listener>();
	private hydrated = false;

	private hydrate(): void {
		if (this.hydrated || typeof window === "undefined") {
			this.hydrated = true;
			return;
		}
		this.hydrated = true;
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<PersistedState>;
			if (parsed && typeof parsed === "object") {
				this.state = {
					active: Boolean(parsed.active),
					data:
						parsed.data && typeof parsed.data === "object"
							? (parsed.data as PersonaPayload)
							: {},
				};
			}
		} catch {
			// corrupt storage — fall back to empty
		}
	}

	private persist(): void {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
		} catch {
			// quota / private mode — ignore
		}
	}

	subscribe = (listener: Listener): (() => void) => {
		this.hydrate();
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): PersistedState => {
		this.hydrate();
		return this.state;
	};

	getServerSnapshot = (): PersistedState => EMPTY_STATE;

	private update(next: PersistedState): void {
		this.state = next;
		this.persist();
		for (const l of this.listeners) l();
	}

	setData(data: PersonaPayload): void {
		this.update({ ...this.state, data });
	}

	setActive(active: boolean): void {
		this.update({ ...this.state, active });
	}

	saveAndActivate(data: PersonaPayload): void {
		this.update({ active: true, data });
	}

	clear(): void {
		this.update(EMPTY_STATE);
	}
}

export const personaStore = new PersonaStore();

export function usePersonaState(): PersistedState {
	return useSyncExternalStore(
		personaStore.subscribe,
		personaStore.getSnapshot,
		personaStore.getServerSnapshot,
	);
}

/** Returns the persona payload to attach to outgoing chat requests, or
 *  `undefined` when no persona is active. */
export function useActivePersona(): PersonaPayload | undefined {
	const state = usePersonaState();
	return state.active && Object.keys(state.data).length > 0
		? state.data
		: undefined;
}
