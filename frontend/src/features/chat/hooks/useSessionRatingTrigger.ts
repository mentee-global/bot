import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	FeedbackTriggerConfig,
	Message,
	ThreadRating,
} from "#/features/chat/data/chat.types";
import { track } from "#/lib/analytics";

const THREADS_KEY = "mentee.chat.session_rating.threads.v1";
const INTERACTIONS_KEY = "mentee.chat.session_rating.interactions.v1";
// Same-tab signal so the trigger hook re-reads after a send bumps the counter.
// `storage` events only fire across tabs, so we dispatch a CustomEvent locally.
const INTERACTIONS_EVENT = "mentee.session_rating.interactions";
// Legacy keys we still wipe on logout for hygiene — replaced by the
// admin-controlled config below.
const LEGACY_COOLDOWN_KEY = "mentee.chat.session_rating.cooldown.v1";

/** Defaults applied while the server config is loading or unreachable.
 * Must match the seed values in the `feedback_trigger_config` migration so a
 * fresh client behaves identically to one with the cache primed. */
const DEFAULT_CONFIG: FeedbackTriggerConfig = {
	enabled: true,
	mode: "interactions",
	interactions_first: 5,
	interactions_repeat: 15,
	time_first_minutes: 1440,
	time_repeat_minutes: 10080,
	re_rate_after_messages: 0,
	updated_at: new Date(0).toISOString(),
	updated_by_user_id: null,
};

type ThreadTerminalState = "rated" | "dismissed";

interface ThreadStateEntry {
	state: ThreadTerminalState;
	at: number;
}

type ThreadStateMap = Record<string, ThreadStateEntry>;

interface InteractionState {
	/** Lifetime count of user messages sent in this browser. */
	count: number;
	/** Snapshot of `count` at the moment the card was last revealed. Drives
	 * the "next ask at lastShownAtCount + interactions_repeat" cadence; 0
	 * means never shown, so the next ask is at interactions_first. */
	lastShownAtCount: number;
	/** Epoch ms of the user's first send in this browser. Drives the time-mode
	 * "first ask after time_first_minutes since first activity" check.
	 * `null` until the first send. */
	firstActiveAt: number | null;
	/** Epoch ms when the card was last revealed. Drives the time-mode "repeat
	 * every time_repeat_minutes" check. `null` until first reveal. */
	lastShownAt: number | null;
}

const EMPTY_INTERACTIONS: InteractionState = {
	count: 0,
	lastShownAtCount: 0,
	firstActiveAt: null,
	lastShownAt: null,
};

function readThreadStates(): ThreadStateMap {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(THREADS_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: ThreadStateMap = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (
					v &&
					typeof v === "object" &&
					"state" in v &&
					"at" in v &&
					(v.state === "rated" || v.state === "dismissed") &&
					typeof v.at === "number"
				) {
					out[k] = { state: v.state, at: v.at };
				}
			}
			return out;
		}
	} catch {
		// fall through
	}
	return {};
}

function writeThreadStates(states: ThreadStateMap) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(THREADS_KEY, JSON.stringify(states));
	} catch {
		// best-effort; ignore quota errors
	}
}

function readInteractions(): InteractionState {
	if (typeof window === "undefined") return EMPTY_INTERACTIONS;
	try {
		const raw = window.localStorage.getItem(INTERACTIONS_KEY);
		if (!raw) return EMPTY_INTERACTIONS;
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.count === "number" &&
			typeof parsed.lastShownAtCount === "number" &&
			parsed.count >= 0 &&
			parsed.lastShownAtCount >= 0
		) {
			const firstActiveAt =
				typeof parsed.firstActiveAt === "number" ? parsed.firstActiveAt : null;
			const lastShownAt =
				typeof parsed.lastShownAt === "number" ? parsed.lastShownAt : null;
			return {
				count: parsed.count,
				lastShownAtCount: parsed.lastShownAtCount,
				firstActiveAt,
				lastShownAt,
			};
		}
	} catch {
		// fall through
	}
	return EMPTY_INTERACTIONS;
}

function writeInteractions(state: InteractionState) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(INTERACTIONS_KEY, JSON.stringify(state));
		// Same-tab notification — `storage` events only fire in OTHER tabs.
		window.dispatchEvent(new Event(INTERACTIONS_EVENT));
	} catch {
		// ignore quota errors
	}
}

/**
 * Increment the lifetime user-message counter. Called from the chat send
 * hooks (`useStreamMessage`, `useSendMessageMutation`) on every user-initiated
 * send. Also stamps `firstActiveAt` on the very first call so the time-based
 * trigger has a "first activity" anchor.
 */
export function bumpInteractionCount() {
	const cur = readInteractions();
	const nextCount = cur.count + 1;
	writeInteractions({
		...cur,
		count: nextCount,
		// Stamp `firstActiveAt` once, on the first ever message in this browser.
		firstActiveAt: cur.firstActiveAt ?? Date.now(),
	});
}

/** Wipe all session-rating client state. Called from logout so a new user on
 * the same browser starts with a clean slate. */
export function clearSessionRatingState() {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(THREADS_KEY);
		window.localStorage.removeItem(INTERACTIONS_KEY);
		window.localStorage.removeItem(LEGACY_COOLDOWN_KEY);
	} catch {
		// ignore
	}
}

interface UseSessionRatingTriggerArgs {
	threadId: string | null;
	messages: Message[];
	isStreaming: boolean;
	/** Persisted server-side rating, if the user has already rated this thread
	 * from any device. When non-null the card is suppressed regardless of
	 * localStorage state. */
	persistedRating?: ThreadRating | null;
	/** Admin-controlled cadence config. While loading or on error, falls back
	 * to `DEFAULT_CONFIG` (matches DB seed) so the trigger keeps working. */
	config?: FeedbackTriggerConfig | null;
}

interface UseSessionRatingTriggerResult {
	isVisible: boolean;
	dismiss: (opts?: { hadPartial?: boolean }) => void;
	markRated: () => void;
	assistantTurns: number;
	shownAt: number | null;
	/** Lifetime user-message count, surfaced for analytics. */
	interactionCount: number;
}

/**
 * Decide when to show the per-conversation rating card.
 *
 * Cadence is admin-controlled via `feedback_trigger_config`:
 *   - mode `interactions`: ask after N user messages (lifetime), then every
 *     M messages.
 *   - mode `time`: ask after T minutes since first activity, then every U
 *     minutes since the last ask.
 *   - `enabled = false`: never ask.
 *
 * Suppression layers (always apply):
 *   - Rated thread — locked unless `config.re_rate_after_messages > 0` AND
 *     the user has sent that many more in-thread messages since the rating.
 *     This lets long conversations be re-rated as quality drifts; the new
 *     star value overwrites the old via the upsert on the backend.
 *   - Server rating — `persistedRating` from `GET /threads/{id}/rating`
 *     anchors the rating timestamp across devices, so the re-rate clock
 *     keeps running even on a fresh browser.
 *   - Dismissed threads are NOT permanently locked: the cadence's
 *     `interactions_repeat` (or time threshold) decides when to re-ask, even
 *     within the same conversation. Admins who want a sparser nag should
 *     raise the repeat interval, not depend on the dismiss to silence it.
 *
 * Once shown for a thread, the card is sticky for that thread until the user
 * explicitly handles it (rate or dismiss). It does NOT hide when the user
 * starts typing — the card is non-blocking and inline.
 */
export function useSessionRatingTrigger(
	args: UseSessionRatingTriggerArgs,
): UseSessionRatingTriggerResult {
	const {
		threadId,
		messages,
		isStreaming,
		persistedRating,
		config: configArg,
	} = args;

	const config = configArg ?? DEFAULT_CONFIG;

	const [threadStates, setThreadStates] = useState<ThreadStateMap>(() =>
		readThreadStates(),
	);
	const [interactions, setInteractions] = useState<InteractionState>(() =>
		readInteractions(),
	);
	const [shownThreadId, setShownThreadId] = useState<string | null>(null);
	const [shownAt, setShownAt] = useState<number | null>(null);

	useEffect(() => {
		const refreshThreads = () => setThreadStates(readThreadStates());
		const refreshInteractions = () => setInteractions(readInteractions());
		const onStorage = (e: StorageEvent) => {
			if (e.key === THREADS_KEY) refreshThreads();
			else if (e.key === INTERACTIONS_KEY) refreshInteractions();
		};
		window.addEventListener("storage", onStorage);
		window.addEventListener(INTERACTIONS_EVENT, refreshInteractions);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener(INTERACTIONS_EVENT, refreshInteractions);
		};
	}, []);

	// Re-evaluate from scratch when the user switches threads — never carry
	// "shown" state across threads. The body doesn't read threadId itself,
	// only depends on its identity to retrigger.
	// biome-ignore lint/correctness/useExhaustiveDependencies: thread switch triggers the reset
	useEffect(() => {
		setShownThreadId(null);
		setShownAt(null);
	}, [threadId]);

	const assistantTurns = useMemo(
		() => messages.filter((m) => m.role === "assistant" && !m.streaming).length,
		[messages],
	);

	const threadEntry = threadId !== null ? threadStates[threadId] : null;
	// `rated` is durable — a thread that's been rated normally won't ask
	// again, BUT the admin can opt into a re-rate threshold so long-running
	// conversations get re-evaluated as quality drifts. `dismissed` is not a
	// permanent block — the cadence's interaction count governs when to ask
	// next, even within the same conversation.
	const localDismissed = threadEntry?.state === "dismissed";
	const localRated = threadEntry?.state === "rated";
	// Source of truth for the rating timestamp: prefer the server's
	// `updated_at` (most recent across devices), fall back to the local
	// terminal-state `at` if we don't have a server row yet.
	const ratedAt = useMemo<number | null>(() => {
		if (persistedRating) return Date.parse(persistedRating.updated_at) || null;
		if (localRated && threadEntry) return threadEntry.at;
		return null;
	}, [persistedRating, localRated, threadEntry]);

	// Count user messages in this thread sent AFTER the rating. Drives the
	// re-rate unlock: once the user has sent enough fresh messages on the
	// same thread, the rating becomes stale and we ask again.
	const inThreadMessagesSinceRating = useMemo<number>(() => {
		if (ratedAt === null) return 0;
		let n = 0;
		for (const m of messages) {
			if (m.role !== "user") continue;
			const ts = Date.parse(m.created_at);
			if (Number.isFinite(ts) && ts > ratedAt) n += 1;
		}
		return n;
	}, [messages, ratedAt]);

	const reRateUnlocked =
		config.re_rate_after_messages > 0 &&
		inThreadMessagesSinceRating >= config.re_rate_after_messages;

	// Final lock decision:
	//   - locally dismissed → never blocks; the cadence alone re-asks.
	//   - locally rated OR rated on server → blocked, UNLESS the re-rate
	//     threshold is configured and reached.
	//   - otherwise → not blocked.
	const threadLocked =
		!localDismissed &&
		(localRated ||
			(persistedRating !== null && persistedRating !== undefined)) &&
		!reRateUnlocked;

	const meetsThreshold = useMemo(
		() => evaluateThreshold(config, interactions, Date.now()),
		[config, interactions],
	);

	const isAlreadyShownForThisThread = shownThreadId === threadId;

	const reveal = useCallback(
		(triggerKind: "interactions" | "time") => {
			if (!threadId) return;
			const cur = readInteractions();
			const now = Date.now();
			setShownThreadId(threadId);
			setShownAt(now);
			// Advance both timers immediately on reveal. Ignoring the card
			// (closing the tab without responding) still pushes the next ask
			// to the next threshold — we don't keep nagging on every refresh.
			writeInteractions({
				...cur,
				lastShownAtCount: cur.count,
				lastShownAt: now,
			});
			track("chat.session_rating_shown", {
				thread_id: threadId,
				trigger: triggerKind,
				interaction_count: cur.count,
				mode: config.mode,
			});
		},
		[config.mode, threadId],
	);

	// Single trigger effect. Show the card when ANY enabled threshold is
	// met (per `mode`) AND the active thread is eligible AND the assistant
	// has just finished a reply (so the prompt doesn't interrupt streaming).
	useEffect(() => {
		if (
			!config.enabled ||
			threadId === null ||
			threadLocked ||
			isAlreadyShownForThisThread ||
			isStreaming ||
			assistantTurns < 1 ||
			meetsThreshold === null
		) {
			return;
		}
		reveal(meetsThreshold);
	}, [
		config.enabled,
		threadId,
		threadLocked,
		isAlreadyShownForThisThread,
		isStreaming,
		assistantTurns,
		meetsThreshold,
		reveal,
	]);

	const finalize = useCallback(
		(state: ThreadTerminalState) => {
			if (!threadId) return;
			const now = Date.now();
			setThreadStates((prev) => {
				const next: ThreadStateMap = {
					...prev,
					[threadId]: { state, at: now },
				};
				writeThreadStates(next);
				return next;
			});
			// Make sure thresholds are advanced even if reveal() didn't run yet
			// (defensive — shouldn't happen since the card can only be handled
			// after being shown).
			const cur = readInteractions();
			if (cur.lastShownAtCount < cur.count || cur.lastShownAt === null) {
				writeInteractions({
					...cur,
					lastShownAtCount: cur.count,
					lastShownAt: now,
				});
			}
		},
		[threadId],
	);

	const dismiss = useCallback(
		(opts?: { hadPartial?: boolean }) => {
			if (!threadId) return;
			track("chat.session_rating_dismissed", {
				thread_id: threadId,
				assistant_turns: assistantTurns,
				interaction_count: interactions.count,
				had_partial: Boolean(opts?.hadPartial),
				mode: config.mode,
			});
			finalize("dismissed");
			// Unmount the card immediately. Threshold has already advanced in
			// reveal(), so the next ask waits for the next interaction milestone
			// — but the thread itself isn't permanently locked the way `rated`
			// threads are, since "dismissed" means "not now", not "never".
			setShownThreadId(null);
			setShownAt(null);
		},
		[assistantTurns, config.mode, finalize, interactions.count, threadId],
	);

	const markRated = useCallback(() => {
		finalize("rated");
		// Mirror dismiss: reset local "shown" state so the next eligible reveal
		// (e.g., after the user crosses `re_rate_after_messages`) goes through
		// `reveal()` again and advances the cadence threshold. Without this the
		// card can re-appear via `isVisible` flipping back to true, but
		// `reveal()` never fires, so `lastShownAtCount` gets stuck.
		setShownThreadId(null);
		setShownAt(null);
	}, [finalize]);

	// `isVisible` decouples from the trigger gates after the first reveal:
	// once shown, stay shown until the user handles it. Otherwise advancing
	// the threshold inside `reveal()` would unmount the card mid-rating.
	// Only a fully-locked thread blocks the visible card; dismiss handles
	// its own unmount by clearing `shownThreadId`.
	const isVisible = isAlreadyShownForThisThread && !threadLocked;

	return {
		isVisible,
		dismiss,
		markRated,
		assistantTurns,
		shownAt,
		interactionCount: interactions.count,
	};
}

// ---------------------------------------------------------------------------
// Threshold evaluation
// ---------------------------------------------------------------------------

/** Return which trigger fired (or null if none). */
function evaluateThreshold(
	config: FeedbackTriggerConfig,
	state: InteractionState,
	now: number,
): "interactions" | "time" | null {
	if (!config.enabled) return null;
	if (
		config.mode === "interactions" &&
		meetsInteractionThreshold(config, state)
	) {
		return "interactions";
	}
	if (config.mode === "time" && meetsTimeThreshold(config, state, now)) {
		return "time";
	}
	return null;
}

function meetsInteractionThreshold(
	config: FeedbackTriggerConfig,
	state: InteractionState,
): boolean {
	const next =
		state.lastShownAtCount === 0
			? config.interactions_first
			: state.lastShownAtCount + config.interactions_repeat;
	return state.count >= next;
}

function meetsTimeThreshold(
	config: FeedbackTriggerConfig,
	state: InteractionState,
	now: number,
): boolean {
	// Time mode requires SOME interaction to anchor — without `firstActiveAt`
	// we have no clock. Avoids asking new users with zero engagement.
	if (state.firstActiveAt === null) return false;
	if (state.lastShownAt === null) {
		return now - state.firstActiveAt >= config.time_first_minutes * 60_000;
	}
	return now - state.lastShownAt >= config.time_repeat_minutes * 60_000;
}
