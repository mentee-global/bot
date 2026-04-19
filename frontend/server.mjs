// Node HTTP wrapper for the TanStack Start SSR build on Railway.
//
// Serves static client assets from `dist/client/` and delegates everything
// else to the fetch-style handler exported by `dist/server/server.js`.
// Requires Node 20+ (global Request/Response).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = join(__dirname, "dist", "client");
const SERVER_ENTRY = join(__dirname, "dist", "server", "server.js");
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

const { default: ssrHandler } = await import(SERVER_ENTRY);

async function resolveStatic(urlPath) {
	const safe = normalize(decodeURIComponent(urlPath)).replace(
		new RegExp(`^(\\.\\.(${sep}|/))+`),
		"",
	);
	const absolute = join(CLIENT_DIR, safe);
	if (!absolute.startsWith(CLIENT_DIR)) return null;
	try {
		const s = await stat(absolute);
		if (s.isFile()) return absolute;
	} catch {}
	return null;
}

async function readBody(req) {
	if (req.method === "GET" || req.method === "HEAD") return undefined;
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

async function serveStatic(res, path) {
	const ext = extname(path).toLowerCase();
	const contentType = MIME[ext] ?? "application/octet-stream";
	res.writeHead(200, {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=31536000, immutable",
	});
	return new Promise((resolve) => {
		const stream = createReadStream(path);
		stream.on("error", () => {
			if (!res.headersSent) res.writeHead(500);
			res.end("Internal Server Error");
			resolve();
		});
		stream.on("end", resolve);
		stream.pipe(res);
	});
}

async function serveSsr(req, res) {
	const url = `http://${req.headers.host}${req.url}`;
	const body = await readBody(req);
	const request = new Request(url, {
		method: req.method,
		headers: new Headers(
			Object.entries(req.headers).map(([k, v]) => [
				k,
				Array.isArray(v) ? v.join(",") : String(v),
			]),
		),
		body: body && body.length ? body : undefined,
		duplex: body && body.length ? "half" : undefined,
	});

	const response = await ssrHandler.fetch(request);
	const headers = {};
	for (const [k, v] of response.headers.entries()) {
		if (!headers[k]) headers[k] = v;
	}
	res.writeHead(response.status, headers);
	if (response.body) {
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			res.write(Buffer.from(value));
		}
	}
	res.end();
}

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		const staticPath = await resolveStatic(url.pathname);
		if (staticPath) {
			await serveStatic(res, staticPath);
			return;
		}
		await serveSsr(req, res);
	} catch (err) {
		console.error("serve error:", err);
		if (!res.headersSent) res.writeHead(500);
		res.end("Internal Server Error");
	}
});

server.listen(port, host, () => {
	console.log(`frontend listening on http://${host}:${port}`);
});
