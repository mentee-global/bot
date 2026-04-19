/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// React plugin intentionally omitted: our main vite is v8 (rolldown-based) but
// vitest still bundles vite v7 (rollup-based), so loading the react plugin here
// produces a type clash. The auth.service tests only touch pure TS — if/when
// we add .tsx component tests we can re-enable the plugin with `as never` cast
// or migrate vitest once its rolldown-vite support ships.
export default defineConfig({
	resolve: {
		alias: {
			"#": new URL("./src", import.meta.url).pathname,
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./vitest.setup.ts"],
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
