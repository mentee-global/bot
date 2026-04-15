import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	useLogoutMutation,
	useSession,
} from "#/features/auth/hooks/useSession";
import { ChatInput } from "#/features/chat/components/ChatInput";
import { MessageList } from "#/features/chat/components/MessageList";
import {
	useSendMessageMutation,
	useThreadQuery,
} from "#/features/chat/hooks/useChat";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/chat")({
	component: ChatPage,
});

function ChatPage() {
	const navigate = useNavigate();
	const session = useSession();

	useEffect(() => {
		if (!session.isPending && !session.data) {
			navigate({ to: "/" });
		}
	}, [session.isPending, session.data, navigate]);

	if (session.isPending) {
		return <PageShell>{m.chat_loading_conversation()}</PageShell>;
	}

	if (!session.data) {
		return null;
	}

	return (
		<PageShell>
			<ChatView userName={session.data.name} />
		</PageShell>
	);
}

function PageShell({ children }: { children: React.ReactNode }) {
	return (
		<main className="page-wrap px-4 pb-8 pt-6">
			<section className="surface-card flex h-[calc(100vh-10rem)] flex-col overflow-hidden">
				{children}
			</section>
		</main>
	);
}

function ChatView({ userName }: { userName: string }) {
	const thread = useThreadQuery();
	const sendMessage = useSendMessageMutation();
	const logout = useLogoutMutation();
	const navigate = useNavigate();

	const messages = thread.data?.messages ?? [];

	return (
		<>
			<header className="flex items-center justify-between border-b border-[var(--theme-border)] px-5 py-3">
				<div>
					<p className="island-kicker m-0">{m.chat_kicker()}</p>
					<p className="m-0 text-sm text-[var(--theme-secondary)]">
						{m.chat_signed_in_as({ name: userName })}
					</p>
				</div>
				<button
					type="button"
					onClick={() =>
						logout.mutate(undefined, {
							onSuccess: () => navigate({ to: "/" }),
						})
					}
					className="btn-secondary"
				>
					{m.chat_sign_out()}
				</button>
			</header>
			<div className="flex-1 overflow-y-auto px-5 py-6">
				{thread.isPending ? (
					<p className="text-sm text-[var(--theme-secondary)]">
						{m.chat_loading_conversation()}
					</p>
				) : (
					<MessageList messages={messages} isReplying={sendMessage.isPending} />
				)}
			</div>
			<ChatInput
				onSend={(body) => sendMessage.mutate(body)}
				isSending={sendMessage.isPending}
			/>
		</>
	);
}
