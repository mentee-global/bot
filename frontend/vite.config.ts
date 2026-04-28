import { paraglideVitePlugin } from "@inlang/paraglide-js";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	server: { port: 3001, strictPort: true },
	plugins: [
		devtools(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["url", "cookie", "preferredLanguage", "baseLocale"],
		}),
		tailwindcss(),
		tanstackStart(),
		// Nitro produces a self-contained Node server at .output/server/index.mjs
		// (see TanStack Start hosting docs). Preset defaults to `node-server`,
		// which is what Railway runs via `node .output/server/index.mjs`.
		nitro(),
		// React Compiler: plugin-react v6 dropped the `babel` option (Vite 8 + Oxc
		// handle JSX/Fast Refresh natively), so the compiler now plugs in via
		// @rolldown/plugin-babel + reactCompilerPreset. Must run before viteReact.
		babel({
			include: /\.[jt]sx?$/,
			presets: [reactCompilerPreset()],
		}),
		viteReact(),
	],
});

export default config;
