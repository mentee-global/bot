import { Star, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import type { ThreadStars } from "#/features/chat/data/chat.types";
import { useSubmitSessionRatingMutation } from "#/features/chat/hooks/useFeedback";
import { track } from "#/lib/analytics";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

const COMMENT_MAX = 200;

// Word labels per star value, indexed 1..5. Drives the live label that
// appears next to the stars on hover/select so users get verbal feedback
// alongside the visual fill.
const RATING_LABEL_FNS = [
	null,
	() => m.chat_session_rating_label_1(),
	() => m.chat_session_rating_label_2(),
	() => m.chat_session_rating_label_3(),
	() => m.chat_session_rating_label_4(),
	() => m.chat_session_rating_label_5(),
] as const;

interface SessionRatingCardProps {
	threadId: string;
	assistantTurns: number;
	shownAt: number | null;
	onRated: () => void;
	onDismiss: (opts?: { hadPartial?: boolean }) => void;
}

export function SessionRatingCard({
	threadId,
	assistantTurns,
	shownAt,
	onRated,
	onDismiss,
}: SessionRatingCardProps) {
	const [stars, setStars] = useState<ThreadStars | 0>(0);
	const [hoveredStar, setHoveredStar] = useState<ThreadStars | 0>(0);
	const [comment, setComment] = useState("");
	const submit = useSubmitSessionRatingMutation();

	// Show the hover preview when the user is mousing over the stars; otherwise
	// reflect the actual selection. This is the standard star-rating UX —
	// without it stars feel like checkboxes.
	const displayStars = hoveredStar > 0 ? hoveredStar : stars;
	const labelFn = displayStars > 0 ? RATING_LABEL_FNS[displayStars] : null;
	const dismiss = () => onDismiss({ hadPartial: stars > 0 });

	const send = () => {
		if (stars === 0) return;
		const trimmed = comment.trim();
		submit.mutate(
			{
				threadId,
				stars: stars as ThreadStars,
				comment: trimmed.length > 0 ? trimmed : null,
			},
			{
				onSuccess: () => {
					track("chat.session_rated", {
						thread_id: threadId,
						stars,
						comment_length: trimmed.length,
						assistant_turns: assistantTurns,
						time_to_rate_ms: shownAt ? Date.now() - shownAt : null,
					});
					toast.success(m.chat_session_rating_thanks_toast());
					onRated();
				},
			},
		);
	};

	return (
		<div className="my-3 flex justify-center">
			<section
				className={cn(
					"w-full max-w-2xl rounded-xl border bg-[var(--theme-surface-elevated)] p-3 shadow-sm sm:p-4",
					"border-[var(--theme-border)]",
				)}
				aria-label={m.chat_session_rating_region_aria()}
			>
				<div className="mb-2 flex items-start justify-between gap-3">
					<div>
						<h3 className="text-sm font-semibold text-[var(--theme-primary)]">
							{m.chat_session_rating_title()}
						</h3>
						<p className="mt-0.5 text-xs text-[var(--theme-muted)]">
							{m.chat_session_rating_subtitle()}
						</p>
					</div>
					<button
						type="button"
						onClick={dismiss}
						aria-label={m.chat_session_rating_dismiss_aria()}
						title={m.chat_session_rating_dismiss_aria()}
						className="-m-1 inline-flex size-7 items-center justify-center rounded text-[var(--theme-muted)] transition hover:bg-[var(--theme-surface)] hover:text-[var(--theme-primary)]"
					>
						<X className="size-4" aria-hidden="true" />
					</button>
				</div>

				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
					<fieldset
						aria-label={m.chat_session_rating_region_aria()}
						className="flex items-center gap-0.5 border-0 p-0"
						onMouseLeave={() => setHoveredStar(0)}
						onBlur={() => setHoveredStar(0)}
					>
						{[1, 2, 3, 4, 5].map((n) => (
							<StarButton
								key={n}
								value={n as ThreadStars}
								filled={displayStars >= n}
								selected={stars >= n}
								onClick={() => setStars(n as ThreadStars)}
								onHover={() => setHoveredStar(n as ThreadStars)}
								label={m.chat_session_rating_star_aria({ n })}
							/>
						))}
					</fieldset>
					<span
						aria-live="polite"
						className={cn(
							"min-w-[5rem] text-sm font-medium tabular-nums transition-opacity",
							labelFn
								? "text-[var(--theme-secondary)] opacity-100"
								: "opacity-0",
						)}
					>
						{labelFn ? labelFn() : " "}
					</span>
				</div>

				<Textarea
					value={comment}
					onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
					rows={2}
					maxLength={COMMENT_MAX}
					placeholder={m.chat_session_rating_comment_placeholder()}
					aria-label={m.chat_session_rating_comment_aria()}
					className="mt-3 resize-none border-[var(--theme-border)] bg-transparent"
				/>
				<div className="mt-2 flex items-center justify-between gap-2">
					<span className="text-xs text-[var(--theme-muted)]">
						{COMMENT_MAX - comment.length}
					</span>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={dismiss}
							disabled={submit.isPending}
						>
							{m.chat_session_rating_skip()}
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={send}
							disabled={submit.isPending || stars === 0}
							title={
								stars === 0 ? m.chat_session_rating_submit_hint() : undefined
							}
						>
							{submit.isPending
								? m.chat_session_rating_submitting()
								: m.chat_session_rating_submit()}
						</Button>
					</div>
				</div>
			</section>
		</div>
	);
}

interface StarButtonProps {
	value: ThreadStars;
	/** True when this star should appear filled — drives both selection and
	 * hover preview. Computed by the parent so a hover on star 4 fills 1–4. */
	filled: boolean;
	/** True when this star is part of the locked-in selection (not just
	 * hovered). Used to emphasize the picked rating with a slight scale. */
	selected: boolean;
	onClick: () => void;
	onHover: () => void;
	label: string;
}

function StarButton({
	value,
	filled,
	selected,
	onClick,
	onHover,
	label,
}: StarButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={onHover}
			onFocus={onHover}
			aria-label={label}
			aria-pressed={filled}
			data-value={value}
			className={cn(
				"group inline-flex size-11 items-center justify-center rounded-lg outline-none transition-transform",
				"hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--theme-accent-ring)]",
			)}
		>
			<Star
				aria-hidden="true"
				strokeWidth={1.5}
				className={cn(
					"size-7 transition-colors",
					filled
						? "text-[var(--theme-accent)]"
						: "text-[var(--theme-border-strong)] group-hover:text-[var(--theme-accent-hover)]",
					selected && "drop-shadow-[0_1px_2px_rgba(228,187,79,0.35)]",
				)}
				fill={filled ? "currentColor" : "none"}
			/>
		</button>
	);
}
