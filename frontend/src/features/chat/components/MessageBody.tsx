import { Check, Copy, ExternalLink } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { track } from "#/lib/analytics";
import { m } from "#/paraglide/messages";

// OpenAI Responses API wraps inline citations in PUA delimiters (e.g.
// `\uE200cite\uE202turn0search0\uE201`); we don't yet have the annotation
// map to render them as real links, so strip them.
const PUA_CITATION = /[\uE000-\uF8FF][^\uE000-\uF8FF]*[\uE000-\uF8FF]/g;
const STRAY_PUA = /[\uE000-\uF8FF]/g;

// Backend appends a `<!-- mentee-sources: {url:title,...} -->` trailer
// after the final flush so the SOURCES bar can show titles instead of
// hostnames. Match it once at the end of the body \u2014 non-greedy in case
// JSON contains "-->" sequences (it shouldn't, but defensive).
const SOURCES_TRAILER_RE = /\n*<!-- mentee-sources: (\{.*?\}) -->\s*$/;

// OpenAI web_search emits inline citations as `[host](relative-path)`
// markdown links \u2014 clicking those resolves the href against the current
// chat URL and 404s. The backend expands them on new messages, but
// already-persisted bodies still contain the broken form, so we run
// the same expansion at render time. Empty paths and tracking-only
// fragments (`source=openai`, `openai`, etc.) get dropped \u2014 they're
// stale references the model couldn't link anywhere useful.
const RELATIVE_CITE_RE =
	/\[((?:[a-z0-9-]+\.)+[a-z]{2,})\]\((?!https?:|mailto:|#)([^\s)]*)\)/gi;
const TRACKING_PATH_TOKENS = new Set([
	"openai",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"source",
]);
// Bare-but-broken pseudo-URLs (`.greenhouse.io/praxent/jobs/\u2026`) \u2014 the
// leading char is captured so we don't false-match prose like
// "version 2.5.10/path".
const DOT_URL_RE =
	/(^|[\s(])\.([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)\/(\S+)/gim;

function isGarbageRelPath(path: string): boolean {
	const trimmed = path.replace(/^\/+/, "").trim();
	if (!trimmed) return true;
	if (trimmed.includes("/")) return false;
	const before = trimmed.split("?")[0];
	if (!before) return true;
	const lower = before.toLowerCase();
	if (TRACKING_PATH_TOKENS.has(lower)) return true;
	if (lower.includes("=")) return true;
	if (before.length < 4 && !/\d/.test(before)) return true;
	return false;
}

// Path slots that begin with `.<domain>/` are OpenAI shorthand for "the
// link-text host's parent domain". Strip the prefix so we don't end up
// building `https://gradschool.cornell.edu/.cornell.edu/academics/…`.
const PATH_DOT_DOMAIN_PREFIX_RE = /^\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\//i;

function expandRelativeCitations(md: string): string {
	const rewritten = md.replace(
		RELATIVE_CITE_RE,
		(_match, host: string, path: string) => {
			if (isGarbageRelPath(path)) return "";
			const cleaned = path
				.replace(PATH_DOT_DOMAIN_PREFIX_RE, "")
				.replace(/^\/+/, "");
			return `[${host}](https://${host}/${cleaned})`;
		},
	);
	// Drop empty `()` parens left behind when we strip a garbage citation.
	return rewritten.replace(/ ?\(\s*\)/g, "");
}

// Insert a space when the model glues two URLs together without a
// separator (`https://platzi.com/https://platzi.com/cursos`). Without
// this the URL extractor sees one giant malformed URL.
function splitConcatenatedUrls(md: string): string {
	return md.replace(/(https?:\/\/[^\s]*?)(?=https?:\/\/)/g, "$1 ");
}

function absolutizeDotUrls(md: string): string {
	return md.replace(
		DOT_URL_RE,
		(_m, leading: string, host: string, path: string) =>
			`${leading}https://${host}/${path}`,
	);
}

// Generic path leaves we never reconstruct from, even if a cited URL
// happens to end with one — too easy to false-match prose like "apply/".
const GENERIC_LEAVES = new Set([
	"apply",
	"careers",
	"jobs",
	"home",
	"page",
	"index",
	"main",
	"about",
	"contact",
	"search",
	"login",
	"signup",
	"register",
	"post",
	"posts",
	"list",
	"view",
]);
const ORPHAN_LEAF_RE = /(?<![:/\w.])([a-z][a-z0-9_-]{3,})\/(?![\w])/gi;

// When the model writes only the trailing slug of a citation
// (`nrtai/`) — losing the host — try to round-trip it via any URL
// already present in the body that ends with the same leaf segment.
function reconstructOrphanPaths(md: string): string {
	const urlRe = /\bhttps?:\/\/[^\s)\]]+/gi;
	const byLeaf = new Map<string, string>();
	for (const m of md.matchAll(urlRe)) {
		const url = m[0].replace(/[.,;:!?)\]]+$/, "");
		try {
			const u = new URL(url);
			const segs = u.pathname.replace(/\/+$/, "").split("/");
			const leaf = segs[segs.length - 1] ?? "";
			const key = leaf.toLowerCase();
			if (leaf.length >= 4 && !GENERIC_LEAVES.has(key) && !byLeaf.has(key)) {
				byLeaf.set(key, url);
			}
		} catch {
			// malformed URL — skip
		}
	}
	if (byLeaf.size === 0) return md;
	return md.replace(ORPHAN_LEAF_RE, (match, slug: string) => {
		const url = byLeaf.get(slug.toLowerCase());
		return url ?? match;
	});
}

// Curated TLDs so we don't autolink things like "v1.2.3" or "file.tar.gz".
const COMMON_TLDS =
	"com|org|net|edu|gov|io|co|ai|app|dev|info|uk|au|ca|de|fr|es|it|nz|jp|in|br|mx|ar|ch|nl|se|no|dk|fi|pt|ie|be|at|pl|cz|za|sg|hk|kr";
const BARE_DOMAIN_RE = new RegExp(
	`(^|[\\s(\\[])` +
		`((?:[a-z0-9-]+\\.)+(?:${COMMON_TLDS}))` +
		`(?![a-z0-9\\-./:])`,
	"gi",
);

function autolinkBareDomains(md: string): string {
	return md.replace(
		BARE_DOMAIN_RE,
		(_match, prefix: string, domain: string) => {
			// Already inside a markdown link target — leave it alone.
			if (prefix === "(" || prefix === "[") return `${prefix}${domain}`;
			return `${prefix}[${domain}](https://${domain})`;
		},
	);
}

function stripSourcesTrailer(body: string): string {
	return body.replace(SOURCES_TRAILER_RE, "");
}

function parseSourcesTrailer(body: string): Record<string, string> {
	const m = body.match(SOURCES_TRAILER_RE);
	if (!m) return {};
	try {
		const parsed = JSON.parse(m[1]) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: Record<string, string> = {};
			for (const [url, title] of Object.entries(parsed)) {
				if (typeof title === "string" && title.trim()) {
					out[url] = title.trim();
				}
			}
			return out;
		}
	} catch {
		// malformed JSON — silently fall back to hostname-only pills
	}
	return {};
}

function sanitize(body: string): string {
	const trailerless = stripSourcesTrailer(body);
	const cleaned = trailerless.replace(PUA_CITATION, "").replace(STRAY_PUA, "");
	return autolinkBareDomains(
		reconstructOrphanPaths(
			splitConcatenatedUrls(
				absolutizeDotUrls(expandRelativeCitations(cleaned)),
			),
		),
	);
}

export function stripChatBody(body: string): string {
	return stripSourcesTrailer(body)
		.replace(PUA_CITATION, "")
		.replace(STRAY_PUA, "");
}

interface Source {
	url: string;
	hostname: string;
	/** Page title from web_search annotations, when available. */
	title?: string;
}

// Path components that don't carry meaning on their own — usually wrappers
// around the actual content slug. We skip them when picking a fallback
// label so e.g. `/jobs/view/spanish-support-12345` lands on the slug.
const SKIP_PATH_SEGMENTS = new Set([
	"jobs",
	"job",
	"view",
	"role",
	"roles",
	"company",
	"companies",
	"l",
	"hc",
	"en-us",
	"en",
	"page",
	"posts",
	"p",
	"q",
	"search",
	"detail",
	"details",
]);

// Segments that look like opaque identifiers — UUIDs, hex blobs, or pure
// digits. Skipped so the label lands on a human-readable slug.
const ID_SEGMENT_RE = /^(?:[a-f0-9]{8,}(?:-[a-f0-9]+)*|\d+)$/i;

function cleanupSlug(seg: string): string {
	const decoded = decodeURIComponent(seg)
		.replace(/\.(?:html?|php|aspx?|jsp)$/i, "") // file extensions
		.replace(/[-_+]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	// Drop trailing numeric / hex IDs that the slug suffix conventions leave behind.
	const withoutTail = decoded
		.replace(/\s\d{4,}$/, "")
		.replace(/\s[a-f0-9]{8,}$/i, "")
		.trim();
	const final = withoutTail || decoded;
	return final.replace(/\b[\p{Ll}]/gu, (c) => c.toUpperCase());
}

function deriveFallbackTitle(u: URL): string | undefined {
	const segments = u.pathname.split("/").filter(Boolean);
	if (segments.length === 0) return undefined;
	// Find meaningful slugs — anything with letters that isn't a wrapper or
	// an opaque ID. Take the last 1-2 (closer to the leaf, more specific).
	const meaningful: string[] = [];
	for (let i = segments.length - 1; i >= 0 && meaningful.length < 2; i--) {
		const seg = segments[i];
		const lower = seg.toLowerCase();
		if (SKIP_PATH_SEGMENTS.has(lower)) continue;
		if (ID_SEGMENT_RE.test(seg)) continue;
		if (!/[a-z]/i.test(seg)) continue;
		meaningful.unshift(cleanupSlug(seg));
	}
	if (meaningful.length === 0) return undefined;
	// If the leaf is a short single word (e.g. "Colombia"), pair it with
	// its parent ("Software Engineer / Colombia") so the pill carries
	// enough context to differentiate from siblings.
	let label =
		meaningful.length > 1 && meaningful[1].split(" ").length <= 2
			? `${meaningful[0]} / ${meaningful[1]}`
			: meaningful[meaningful.length - 1];
	if (label.length > 60) label = `${label.slice(0, 57)}…`;
	return label;
}

function extractSources(
	body: string,
	titles: Record<string, string>,
): Source[] {
	const found = new Map<string, Source>();
	const urlRe = /\bhttps?:\/\/[^\s)\]]+/gi;
	for (const match of body.matchAll(urlRe)) {
		const raw = match[0].replace(/[.,;:!?)\]]+$/, "");
		if (found.has(raw)) continue;
		try {
			const u = new URL(raw);
			const hostname = u.hostname.replace(/^www\./, "");
			// Trailer keys are stored without trailing slash; match either form.
			const annotated =
				titles[raw] ?? titles[raw.replace(/\/$/, "")] ?? undefined;
			// Fall back to a path-derived label so two URLs from the same host
			// don't render as identical hostname-only pills.
			const title = annotated ?? deriveFallbackTitle(u);
			found.set(raw, { url: raw, hostname, title });
		} catch {
			// malformed URL — skip
		}
	}
	return Array.from(found.values());
}

const components: Components = {
	a: ({ href, children, ...rest }) => (
		<a
			{...rest}
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			className="text-[var(--theme-primary)] underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-[var(--theme-accent)]"
		>
			{children}
		</a>
	),
	pre: ({ children, ...rest }) => <CodeBlock {...rest}>{children}</CodeBlock>,
};

function CodeBlock({
	children,
	...rest
}: React.HTMLAttributes<HTMLPreElement>) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);

	const onCopy = async () => {
		const text = ref.current?.innerText ?? "";
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			toast.success(m.chat_copied_toast());
			track("chat.code_copied");
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error(m.chat_copy_failed_toast());
		}
	};

	return (
		<div className="group relative">
			<pre {...rest} ref={ref}>
				{children}
			</pre>
			<button
				type="button"
				onClick={onCopy}
				aria-label={m.chat_copy_code_aria()}
				className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:text-[var(--theme-primary)]"
			>
				{copied ? (
					<Check aria-hidden="true" className="size-3.5" />
				) : (
					<Copy aria-hidden="true" className="size-3.5" />
				)}
			</button>
		</div>
	);
}

interface MessageBodyProps {
	body: string;
	streaming?: boolean;
}

function MessageBodyImpl({ body, streaming }: MessageBodyProps) {
	const clean = useMemo(() => sanitize(body), [body]);
	const titles = useMemo(() => parseSourcesTrailer(body), [body]);
	// Suppress sources mid-stream — URLs arrive character by character and
	// the list would flicker.
	const sources = useMemo(
		() => (streaming ? [] : extractSources(clean, titles)),
		[clean, titles, streaming],
	);

	return (
		<div>
			<div className="prose prose-sm max-w-none text-[var(--theme-primary)] prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[var(--theme-primary)] prose-headings:mt-3 prose-headings:mb-1 prose-headings:text-[var(--theme-primary)] prose-pre:my-2 prose-pre:bg-[var(--theme-bg)] prose-pre:border prose-pre:border-[var(--theme-border)] prose-pre:text-[var(--theme-primary)] prose-code:before:content-none prose-code:after:content-none prose-code:text-[var(--theme-primary)] prose-strong:text-[var(--theme-primary)] prose-blockquote:text-[var(--theme-secondary)] prose-blockquote:border-[var(--theme-border)] prose-hr:border-[var(--theme-border)]">
				<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
					{clean}
				</ReactMarkdown>
				{streaming ? (
					<span
						aria-hidden="true"
						className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline"
					/>
				) : null}
			</div>
			{sources.length > 0 ? <SourceBar sources={sources} /> : null}
		</div>
	);
}

export const MessageBody = memo(MessageBodyImpl);

function SourceBar({ sources }: { sources: Source[] }) {
	return (
		<div className="mt-3 border-t border-[var(--theme-border)] pt-2">
			<p className="island-kicker m-0 mb-1.5">Sources</p>
			<ul className="m-0 flex flex-wrap gap-1.5 p-0">
				{sources.map((s) => {
					// Prefer the page title (richer, distinguishes two URLs from
					// the same site) and use the hostname as the tooltip so the
					// underlying domain is still visible on hover.
					const label = s.title ?? s.hostname;
					return (
						<li key={s.url} className="list-none">
							<a
								href={s.url}
								target="_blank"
								rel="noreferrer noopener"
								title={s.title ? s.hostname : undefined}
								className="inline-flex items-center gap-1.5 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--theme-secondary)] no-underline transition hover:border-[var(--theme-border-strong)] hover:text-[var(--theme-primary)]"
							>
								<img
									src={`https://www.google.com/s2/favicons?domain=${s.hostname}&sz=32`}
									alt=""
									width={12}
									height={12}
									className="rounded-sm"
									loading="lazy"
								/>
								<span className="truncate max-w-[220px]">{label}</span>
								<ExternalLink
									aria-hidden="true"
									className="size-3 opacity-60"
								/>
							</a>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
