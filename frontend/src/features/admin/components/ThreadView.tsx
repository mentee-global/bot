import { Download, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/ui/Dialog";
import type { AdminThreadResponse } from "#/features/admin/data/admin.types";
import {
	useAdminThreadQuery,
	useDeleteThreadMutation,
} from "#/features/admin/hooks/useAdmin";
import type { Message } from "#/features/chat/data/chat.types";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import {
	BackLink,
	CompactDate,
	EmptyState,
	ErrorState,
	LoadingState,
	StatItem,
} from "./shared";

export function ThreadView({
	threadId,
	backLabel,
	onBack,
	onDeleted,
}: {
	threadId: string;
	backLabel: string;
	onBack: () => void;
	onDeleted: () => void;
}) {
	const thread = useAdminThreadQuery(threadId);
	const deleteMutation = useDeleteThreadMutation();
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (thread.isPending) return <LoadingState />;
	if (thread.isError) return <ErrorState message={thread.error.message} />;

	const data = thread.data;
	if (!data) return <EmptyState message={m.admin_thread_empty()} />;

	const title = data.title || m.admin_thread_untitled();

	const handleDelete = () => {
		deleteMutation.mutate(threadId, {
			onSuccess: () => {
				setConfirmOpen(false);
				onDeleted();
			},
		});
	};

	return (
		<section>
			<BackLink onClick={onBack}>{backLabel}</BackLink>
			<div className="mt-3 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="m-0 break-words text-lg font-semibold">{title}</h2>
					<OwnerLine data={data} />
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => downloadThread(data, title)}
						className="gap-1.5"
					>
						<Download className="size-3.5" /> {m.admin_export_json()}
					</Button>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => setConfirmOpen(true)}
						className="gap-1.5"
					>
						<Trash2 className="size-3.5" /> {m.admin_delete_thread()}
					</Button>
				</div>
			</div>

			<ThreadInsights data={data} />

			<div className="mt-4">
				{data.messages.length === 0 ? (
					<EmptyState message={m.admin_thread_empty()} />
				) : (
					<Card className="gap-3 overflow-y-auto p-3 sm:max-h-[calc(100dvh-24rem)] sm:p-6">
						{data.messages.map((message) => (
							<AdminMessage key={message.id} message={message} />
						))}
					</Card>
				)}
			</div>

			<ConfirmDeleteDialog
				open={confirmOpen}
				title={title}
				pending={deleteMutation.isPending}
				onCancel={() => setConfirmOpen(false)}
				onConfirm={handleDelete}
			/>
		</section>
	);
}

function OwnerLine({ data }: { data: AdminThreadResponse }) {
	const name = data.owner_name;
	const email = data.owner_email;
	if (!name && !email) {
		return (
			<p className="m-0 mt-1 break-all text-xs text-muted-foreground">
				{m.admin_thread_owner({ id: data.owner_user_id })}
			</p>
		);
	}
	return (
		<p className="m-0 mt-1 text-xs text-muted-foreground">
			<span className="font-medium text-foreground">{name || email}</span>
			{name && email ? <span className="ml-1">· {email}</span> : null}
		</p>
	);
}

function ThreadInsights({ data }: { data: AdminThreadResponse }) {
	const stats = useMemo(() => computeInsights(data), [data]);
	return (
		<Card className="mt-4 gap-3 p-4 sm:p-5">
			<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
				<StatItem label={m.admin_thread_stat_messages()} value={stats.total} />
				<StatItem
					label={m.admin_thread_stat_user_messages()}
					value={stats.userCount}
				/>
				<StatItem
					label={m.admin_thread_stat_assistant_messages()}
					value={stats.assistantCount}
				/>
				<StatItem
					label={m.admin_thread_stat_created()}
					value={<CompactDate iso={data.created_at} />}
				/>
				<StatItem
					label={m.admin_thread_stat_updated()}
					value={<CompactDate iso={data.updated_at} />}
				/>
				<StatItem
					label={m.admin_thread_stat_duration()}
					value={stats.duration}
				/>
			</dl>
		</Card>
	);
}

interface ThreadStats {
	total: number;
	userCount: number;
	assistantCount: number;
	duration: string;
}

function computeInsights(data: AdminThreadResponse): ThreadStats {
	const total = data.messages.length;
	let userCount = 0;
	let assistantCount = 0;
	for (const msg of data.messages) {
		if (msg.role === "user") userCount += 1;
		else if (msg.role === "assistant") assistantCount += 1;
	}
	return {
		total,
		userCount,
		assistantCount,
		duration: formatDuration(data.created_at, data.updated_at),
	};
}

function formatDuration(startIso: string, endIso: string): string {
	const start = new Date(startIso).getTime();
	const end = new Date(endIso).getTime();
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
		return "—";
	const ms = end - start;
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return "<1m";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h`;
}

function AdminMessage({ message }: { message: Message }) {
	const isUser = message.role === "user";
	return (
		<div
			className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
		>
			<div
				className={cn(
					"max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-[80%] sm:px-4",
					isUser
						? "bg-primary text-primary-foreground"
						: "border border-border bg-muted text-foreground",
				)}
			>
				<p className="m-0 whitespace-pre-wrap break-words leading-relaxed">
					{message.body}
				</p>
				<p
					className={cn(
						"m-0 mt-2 text-[10px] uppercase tracking-wide",
						isUser ? "text-primary-foreground/70" : "text-muted-foreground",
					)}
				>
					{message.role} · <CompactDate iso={message.created_at} />
				</p>
			</div>
		</div>
	);
}

function downloadThread(data: AdminThreadResponse, fallbackTitle: string) {
	const payload = {
		...data,
		exported_at: new Date().toISOString(),
	};
	const blob = new Blob([JSON.stringify(payload, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	const safeTitle = (data.title || fallbackTitle)
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.slice(0, 40);
	a.download = `thread-${safeTitle || data.thread_id.slice(0, 8)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

function ConfirmDeleteDialog({
	open,
	title,
	pending,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	title: string;
	pending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(next) => (!next ? onCancel() : null)}>
			<DialogContent>
				<DialogTitle>{m.admin_delete_thread_title()}</DialogTitle>
				<DialogDescription>
					{m.admin_delete_thread_body({ title })}
				</DialogDescription>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel} disabled={pending}>
						{m.common_cancel()}
					</Button>
					<Button variant="destructive" onClick={onConfirm} disabled={pending}>
						{pending
							? m.admin_delete_thread_pending()
							: m.admin_delete_thread_confirm()}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
