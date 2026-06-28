import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FileUp, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Textarea } from "#/components/ui/textarea";
import type { User } from "#/features/auth/data/auth.types";
import { useSession } from "#/features/auth/hooks/useSession";
import { useMeQuery } from "#/features/budget/hooks/useBudget";
import { MessageBody } from "#/features/chat/components/MessageBody";
import {
	ALLOWED_UPLOAD_MIMES,
	MAX_CV_BYTES,
} from "#/features/chat/data/documents.types";
import { MenteeProfilePanel } from "#/features/profile/components/MenteeProfilePanel";
import {
	profileQueryOptions,
	profileService,
} from "#/features/profile/data/profile.service";
import {
	useProfileQuery,
	useSaveAboutMutation,
} from "#/features/profile/hooks/useProfile";
import { ApiError } from "#/lib/api/errors";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/profile")({
	component: ProfilePage,
});

function ProfilePage() {
	const session = useSession();
	const navigate = useNavigate();

	useEffect(() => {
		if (session.isPending) return;
		if (!session.data) navigate({ to: "/" });
	}, [session.isPending, session.data, navigate]);

	if (session.isPending || !session.data) return null;
	return <ProfileEditor user={session.data} />;
}

function ProfileEditor({ user }: { user: User }) {
	const profileQuery = useProfileQuery();

	return (
		<main className="page-wrap px-4 pb-20 pt-10">
			<div className="mx-auto w-full max-w-3xl">
				<Link
					to="/chat"
					className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--theme-muted)] transition hover:text-[var(--theme-primary)]"
				>
					<ArrowLeft className="size-4" /> {m.profile_back_to_chat()}
				</Link>

				<h1 className="display-title mb-1 text-2xl font-bold text-[var(--theme-primary)]">
					{m.profile_page_title()}
				</h1>
				<p className="mb-6 text-sm text-[var(--theme-muted)]">
					{m.profile_page_subtitle()}
				</p>

				{/* Read-only data from the Mentee platform (top). */}
				<MenteeProfilePanel user={user} />

				{/* Free-text "about you" (injected into every chat). */}
				<AboutSection
					initial={profileQuery.data?.about_me ?? ""}
					loading={profileQuery.isPending}
				/>

				{/* CV upload + transcription (injected into every chat). */}
				<CvSection />
			</div>
		</main>
	);
}

function SectionHeading({
	title,
	tag,
	tone = "muted",
}: {
	title: string;
	tag: string;
	tone?: "muted" | "accent";
}) {
	return (
		<h2 className="display-title mb-1 flex items-center gap-2 text-xl font-bold text-[var(--theme-primary)]">
			{title}
			<span
				className={`rounded-full px-2 py-0.5 text-xs font-medium ${
					tone === "accent"
						? "bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]"
						: "bg-[var(--theme-surface)] text-[var(--theme-muted)]"
				}`}
			>
				{tag}
			</span>
		</h2>
	);
}

function AboutSection({
	initial,
	loading,
}: {
	initial: string;
	loading: boolean;
}) {
	const saveAbout = useSaveAboutMutation();
	const [value, setValue] = useState(initial);
	const baseline = useRef(initial);

	// Re-seed when the server value arrives / changes (e.g. after a save).
	useEffect(() => {
		setValue(initial);
		baseline.current = initial;
	}, [initial]);

	const dirty = value.trim() !== baseline.current.trim();

	async function handleSave() {
		const next = value.trim();
		try {
			await saveAbout.mutateAsync(next);
			baseline.current = next;
			setValue(next);
			toast.success(m.profile_about_saved());
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : m.profile_about_save_failed(),
			);
		}
	}

	return (
		<section className="mt-10">
			<SectionHeading
				title={m.profile_about_title()}
				tag={m.profile_tag_optional()}
			/>
			<p className="mb-3 text-sm text-[var(--theme-muted)]">
				{m.profile_about_subtitle()}
			</p>
			<Textarea
				rows={5}
				value={value}
				disabled={loading}
				placeholder={m.profile_about_placeholder()}
				onChange={(e) => setValue(e.target.value)}
			/>
			<div className="mt-3">
				<button
					type="button"
					className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!dirty || saveAbout.isPending}
					onClick={() => void handleSave()}
				>
					{saveAbout.isPending ? (
						<Loader2 className="size-4 animate-spin" />
					) : null}
					{m.profile_about_save()}
				</button>
			</div>
		</section>
	);
}

function CvSection() {
	const queryClient = useQueryClient();
	const profileQuery = useProfileQuery();
	const me = useMeQuery();
	const fileInputRef = useRef<HTMLInputElement>(null);

	// CV OCR costs credits (gated server-side too) — block & explain when the
	// mentee has none left. Admins are unlimited, so never blocked.
	const outOfCredits =
		!!me.data && !me.data.credits.unlimited && me.data.credits.remaining <= 0;

	const [docId, setDocId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [extractError, setExtractError] = useState<string | null>(null);
	const [showText, setShowText] = useState(true);

	const removeCv = useMutation({
		mutationFn: (documentId: string) => profileService.removeCv(documentId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: profileQueryOptions.queryKey,
			});
			toast.success(m.profile_cv_removed());
		},
		onError: (err) =>
			toast.error(
				err instanceof ApiError ? err.message : m.profile_cv_remove_failed(),
			),
	});

	// Poll the document while OCR runs; stop at a terminal state.
	const docQuery = useQuery({
		queryKey: ["profile-doc", docId] as const,
		queryFn: ({ signal }) =>
			profileService.getDocument(docId as string, signal),
		enabled: !!docId,
		refetchInterval: (q) => {
			const s = q.state.data?.status;
			return s === "pending" || s === "processing" ? 1500 : false;
		},
	});

	useEffect(() => {
		const doc = docQuery.data;
		if (!doc) return;
		if (doc.status === "ready") {
			setDocId(null);
			void profileQuery.refetch();
			void me.refetch();
			toast.success(
				doc.ocr_credits_charged > 0
					? m.profile_cv_ready_credits({ amount: doc.ocr_credits_charged })
					: m.profile_cv_ready(),
			);
		} else if (doc.status === "failed") {
			setDocId(null);
			setExtractError(doc.error_message || m.profile_extract_failed());
		}
	}, [docQuery.data, profileQuery, me]);

	// Driven by docId (set the moment an upload starts, cleared only when a
	// terminal status arrives), NOT by the poll's current data — otherwise the
	// gap before/between poll responses flips the zone back to idle and flickers.
	const processing = uploading || docId !== null;

	async function handleFile(file: File) {
		setExtractError(null);
		if (outOfCredits) {
			toast.error(m.profile_upload_no_credits());
			return;
		}
		if (!ALLOWED_UPLOAD_MIMES.includes(file.type as never)) {
			toast.error(m.profile_upload_bad_type());
			return;
		}
		if (file.size > MAX_CV_BYTES) {
			toast.error(m.profile_upload_too_big());
			return;
		}
		setUploading(true);
		try {
			const doc = await profileService.uploadCv(file);
			setDocId(doc.id);
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : m.profile_extract_failed(),
			);
		} finally {
			setUploading(false);
		}
	}

	const data = profileQuery.data;
	const hasCv = !!(data?.has_cv && data.cv_markdown);

	return (
		<section className="mt-10">
			<SectionHeading
				title={m.profile_title()}
				tag={m.profile_tag_recommended()}
				tone="accent"
			/>
			<p className="mb-4 text-sm text-[var(--theme-muted)]">
				{m.profile_subtitle()}
			</p>

			{hasCv ? (
				<div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm text-[var(--theme-secondary)]">
					<CheckCircle2 className="size-4 shrink-0 text-[var(--theme-accent)]" />
					<span>{m.profile_cv_active()}</span>
				</div>
			) : null}

			<UploadZone
				processing={processing}
				hasCv={hasCv}
				blockedReason={outOfCredits ? m.profile_upload_no_credits() : null}
				onPick={() => fileInputRef.current?.click()}
				onDropFile={handleFile}
			/>
			<input
				ref={fileInputRef}
				type="file"
				accept={ALLOWED_UPLOAD_MIMES.join(",")}
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void handleFile(file);
					e.target.value = "";
				}}
			/>

			{extractError ? (
				<div className="mt-4 rounded-lg border border-[var(--theme-danger)] bg-[var(--theme-surface)] px-4 py-3 text-sm text-[var(--theme-danger)]">
					<p className="font-medium">{m.profile_extract_failed()}</p>
					<p className="mt-1 text-[var(--theme-secondary)]">{extractError}</p>
				</div>
			) : null}

			{hasCv && data ? (
				<div className="mt-5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)]">
					<div className="flex items-center justify-between gap-3 border-b border-[var(--theme-border)] px-4 py-3">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium text-[var(--theme-primary)]">
								{data.cv_filename}
							</p>
							<p className="text-xs text-[var(--theme-muted)]">
								{m.profile_cv_transcription_title()}
							</p>
							{data.cv_credits_charged > 0 ? (
								<p className="mt-0.5 text-xs text-[var(--theme-muted)]">
									{m.profile_cv_credits_used({
										amount: data.cv_credits_charged,
									})}
								</p>
							) : null}
						</div>
						<div className="flex shrink-0 items-center gap-3">
							<button
								type="button"
								className="text-xs text-[var(--theme-accent)] underline-offset-4 hover:underline"
								onClick={() => setShowText((v) => !v)}
							>
								{showText
									? m.profile_cv_hide_transcription()
									: m.profile_cv_show_transcription()}
							</button>
							<button
								type="button"
								aria-label={m.profile_cv_remove()}
								title={m.profile_cv_remove()}
								className="inline-flex items-center gap-1 text-xs text-[var(--theme-secondary)] transition hover:text-[var(--theme-danger)] disabled:opacity-50"
								disabled={!data.cv_document_id || removeCv.isPending}
								onClick={() =>
									data.cv_document_id && removeCv.mutate(data.cv_document_id)
								}
							>
								{removeCv.isPending ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Trash2 className="size-3.5" />
								)}
								{m.profile_cv_remove()}
							</button>
						</div>
					</div>
					{showText ? (
						<div className="max-h-[28rem] overflow-y-auto px-4 py-3">
							<MessageBody body={data.cv_markdown ?? ""} />
						</div>
					) : null}
				</div>
			) : null}

			{profileQuery.isPending ? (
				<div className="mt-4 flex items-center gap-2 text-sm text-[var(--theme-muted)]">
					<Loader2 className="size-4 animate-spin" /> {m.profile_loading()}
				</div>
			) : null}
		</section>
	);
}

function UploadZone({
	processing,
	hasCv,
	blockedReason,
	onPick,
	onDropFile,
}: {
	processing: boolean;
	hasCv: boolean;
	/** When set, the zone is disabled and this explains why (out of credits). */
	blockedReason: string | null;
	onPick: () => void;
	onDropFile: (file: File) => void;
}) {
	const [dragOver, setDragOver] = useState(false);
	const blocked = !!blockedReason;
	return (
		<>
			<button
				type="button"
				title={blockedReason ?? undefined}
				aria-disabled={blocked}
				onClick={onPick}
				onDragOver={(e) => {
					e.preventDefault();
					if (!blocked) setDragOver(true);
				}}
				onDragLeave={() => setDragOver(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragOver(false);
					if (blocked) return;
					const file = e.dataTransfer.files?.[0];
					if (file) onDropFile(file);
				}}
				disabled={processing || blocked}
				className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition ${
					dragOver
						? "border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]"
						: "border-[var(--theme-border-strong)] bg-[var(--theme-surface)]"
				} disabled:cursor-not-allowed disabled:opacity-60`}
			>
				{processing ? (
					<Loader2 className="size-6 animate-spin text-[var(--theme-accent)]" />
				) : (
					<FileUp className="size-6 text-[var(--theme-muted)]" />
				)}
				<span className="text-sm font-medium text-[var(--theme-primary)]">
					{processing
						? m.profile_extract_running()
						: hasCv
							? m.profile_upload_replace()
							: m.profile_upload_cta()}
				</span>
				<span className="text-xs text-[var(--theme-muted)]">
					{m.profile_upload_hint()}
				</span>
			</button>
			{blocked ? (
				<p className="mt-2 text-center text-xs text-[var(--theme-danger)]">
					{blockedReason}
				</p>
			) : null}
		</>
	);
}
