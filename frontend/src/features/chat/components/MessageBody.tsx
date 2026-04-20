import { ExternalLink } from "lucide-react";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// OpenAI Responses API wraps inline citations in PUA delimiters (e.g.
// `\uE200cite\uE202turn0search0\uE201`); we don't yet have the annotation
// map to render them as real links, so strip them.
const PUA_CITATION = /[\uE000-\uF8FF][^\uE000-\uF8FF]*[\uE000-\uF8FF]/g;
const STRAY_PUA = /[\uE000-\uF8FF]/g;

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

function sanitize(body: string): string {
	const cleaned = body.replace(PUA_CITATION, "").replace(STRAY_PUA, "");
	return autolinkBareDomains(cleaned);
}

interface Source {
	url: string;
	hostname: string;
}

function extractSources(body: string): Source[] {
	const found = new Map<string, Source>();
	const urlRe = /\bhttps?:\/\/[^\s)\]]+/gi;
	for (const match of body.matchAll(urlRe)) {
		const raw = match[0].replace(/[.,;:!?)\]]+$/, "");
		if (found.has(raw)) continue;
		try {
			const u = new URL(raw);
			const hostname = u.hostname.replace(/^www\./, "");
			found.set(raw, { url: raw, hostname });
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
			className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
		>
			{children}
		</a>
	),
};

interface MessageBodyProps {
	body: string;
	streaming?: boolean;
}

function MessageBodyImpl({ body, streaming }: MessageBodyProps) {
	const clean = useMemo(() => sanitize(body), [body]);
	// Suppress sources mid-stream — URLs arrive character by character and
	// the list would flicker.
	const sources = useMemo(
		() => (streaming ? [] : extractSources(clean)),
		[clean, streaming],
	);

	return (
		<div>
			<div className="prose prose-sm max-w-none text-[var(--theme-primary)] prose-p:my-2 prose-p:leading-relaxed prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-pre:my-2 prose-pre:bg-[var(--theme-bg)] prose-pre:border prose-pre:border-[var(--theme-border)] prose-code:before:content-none prose-code:after:content-none prose-strong:text-[var(--theme-primary)]">
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
				{sources.map((s) => (
					<li key={s.url} className="list-none">
						<a
							href={s.url}
							target="_blank"
							rel="noreferrer noopener"
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
							<span className="truncate max-w-[180px]">{s.hostname}</span>
							<ExternalLink aria-hidden="true" className="size-3 opacity-60" />
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}
