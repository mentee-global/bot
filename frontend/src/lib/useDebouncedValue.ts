import { useEffect, useState } from "react";

/**
 * Return a value that trails `input` by `delayMs` — handy for search inputs
 * where we only want to hit the server after the user stops typing.
 */
export function useDebouncedValue<T>(input: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(input);

	useEffect(() => {
		const id = window.setTimeout(() => setDebounced(input), delayMs);
		return () => window.clearTimeout(id);
	}, [input, delayMs]);

	return debounced;
}
