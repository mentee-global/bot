import posthog from "posthog-js";

const isEnabled =
	typeof window !== "undefined" && !!import.meta.env.VITE_POSTHOG_KEY;

export function track(event: string, props?: Record<string, unknown>) {
	if (!isEnabled) return;
	try {
		posthog.capture(event, props);
	} catch {
		// swallow — analytics must never break the UI
	}
}
