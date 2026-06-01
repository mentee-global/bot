import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { User } from "#/features/auth/data/auth.types";
import { useSession } from "#/features/auth/hooks/useSession";
import {
	ALLOWED_UPLOAD_MIMES,
	MAX_UPLOAD_BYTES,
} from "#/features/chat/data/documents.types";
import { CvForm } from "#/features/profile/components/CvForm";
import { MenteeProfilePanel } from "#/features/profile/components/MenteeProfilePanel";
import { profileService } from "#/features/profile/data/profile.service";
import {
	EMPTY_RESUME,
	type ResumeData,
} from "#/features/profile/data/profile.types";
import {
	useProfileQuery,
	useSaveCvMutation,
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
	const saveCv = useSaveCvMutation();

	const [form, setForm] = useState<ResumeData>(EMPTY_RESUME);
	const [docId, setDocId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [extractError, setExtractError] = useState<string | null>(null);
	// Bumped each time we load server data into the form, so the dirty-check
	// baseline tracks the latest extracted/confirmed CV rather than EMPTY.
	const baselineRef = useRef<string>(JSON.stringify(EMPTY_RESUME));
	const fileInputRef = useRef<HTMLInputElement>(null);

	const confirmed = profileQuery.data?.confirmed ?? false;

	// Seed the form from server data on first load (and whenever the cached
	// profile changes, e.g. after extraction completes).
	const serverStructured = profileQuery.data?.cv_structured ?? null;
	const serverKey = serverStructured ? JSON.stringify(serverStructured) : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: serverKey is the value-identity of serverStructured
	useEffect(() => {
		if (serverStructured) {
			setForm(serverStructured);
			baselineRef.current = JSON.stringify(serverStructured);
		}
	}, [serverKey]);

	// Poll the document while extraction runs. Refetch stops at a terminal state.
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
			toast.success(m.profile_extract_done());
		} else if (doc.status === "failed") {
			setDocId(null);
			setExtractError(doc.error_message || m.profile_extract_failed());
		}
	}, [docQuery.data, profileQuery]);

	const processing =
		uploading ||
		docQuery.data?.status === "pending" ||
		docQuery.data?.status === "processing";

	async function handleFile(file: File) {
		setExtractError(null);
		if (!ALLOWED_UPLOAD_MIMES.includes(file.type as never)) {
			toast.error(m.profile_upload_bad_type());
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			toast.error(m.profile_upload_too_big());
			return;
		}
		setUploading(true);
		try {
			const doc = await profileService.uploadCv(file);
			setDocId(doc.id);
		} catch (err) {
			const detail =
				err instanceof ApiError ? err.message : m.profile_extract_failed();
			toast.error(detail);
		} finally {
			setUploading(false);
		}
	}

	const dirty = useMemo(
		() => JSON.stringify(form) !== baselineRef.current,
		[form],
	);
	const canSave = form.name.trim().length > 0 && (!confirmed || dirty);

	async function handleSave() {
		try {
			await saveCv.mutateAsync(form);
			baselineRef.current = JSON.stringify(form);
			toast.success(m.profile_saved());
		} catch (err) {
			const detail =
				err instanceof ApiError ? err.message : m.profile_save_failed();
			toast.error(detail);
		}
	}

	const hasCv = profileQuery.data?.has_cv ?? false;
	const showForm = hasCv || extractError !== null || form.name.length > 0;

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

				{/* CV section (bottom). */}
				<section className="mt-10">
					<h2 className="display-title mb-1 text-xl font-bold text-[var(--theme-primary)]">
						{m.profile_title()}
					</h2>
					<p className="mb-4 text-sm text-[var(--theme-muted)]">
						{m.profile_subtitle()}
					</p>

					{/* Injection-state banner */}
					{hasCv ? (
						confirmed ? (
							<div className="mb-6 flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm text-[var(--theme-secondary)]">
								<CheckCircle2 className="size-4 text-[var(--theme-accent)]" />
								{m.profile_state_confirmed()}
							</div>
						) : (
							<div className="mb-6 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3 text-sm text-[var(--theme-secondary)]">
								{m.profile_state_draft()}
							</div>
						)
					) : null}

					{/* Upload zone */}
					<UploadZone
						processing={processing}
						hasCv={hasCv}
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
						<div className="mt-4 rounded-lg border border-[var(--theme-danger)] bg-[var(--theme-surface)] px-4 py-3 text-sm text-[var(--theme-danger-fg)]">
							<p className="font-medium">{m.profile_extract_failed()}</p>
							<p className="mt-1 text-[var(--theme-secondary)]">
								{extractError}
							</p>
							<p className="mt-1 text-[var(--theme-muted)]">
								{m.profile_manual_hint()}
							</p>
						</div>
					) : null}

					{profileQuery.isPending ? (
						<div className="mt-8 flex items-center gap-2 text-sm text-[var(--theme-muted)]">
							<Loader2 className="size-4 animate-spin" /> {m.profile_loading()}
						</div>
					) : showForm ? (
						<div className="mt-8">
							<CvForm value={form} onChange={setForm} />
							<div className="mt-6 flex items-center gap-3">
								<button
									type="button"
									className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
									disabled={!canSave || saveCv.isPending}
									onClick={() => void handleSave()}
								>
									{saveCv.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : null}
									{m.profile_save()}
								</button>
								{!confirmed ? (
									<span className="text-xs text-[var(--theme-muted)]">
										{m.profile_save_hint()}
									</span>
								) : null}
							</div>
						</div>
					) : (
						<button
							type="button"
							className="mt-4 text-sm text-[var(--theme-accent)] underline-offset-4 hover:underline"
							onClick={() => setForm({ ...EMPTY_RESUME })}
						>
							{m.profile_enter_manually()}
						</button>
					)}
				</section>
			</div>
		</main>
	);
}

function UploadZone({
	processing,
	hasCv,
	onPick,
	onDropFile,
}: {
	processing: boolean;
	hasCv: boolean;
	onPick: () => void;
	onDropFile: (file: File) => void;
}) {
	const [dragOver, setDragOver] = useState(false);
	return (
		<button
			type="button"
			onClick={onPick}
			onDragOver={(e) => {
				e.preventDefault();
				setDragOver(true);
			}}
			onDragLeave={() => setDragOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setDragOver(false);
				const file = e.dataTransfer.files?.[0];
				if (file) onDropFile(file);
			}}
			disabled={processing}
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
	);
}
