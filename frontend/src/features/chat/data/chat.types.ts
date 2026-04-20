export type MessageRole = "user" | "assistant";

export interface Message {
	id: string;
	thread_id: string;
	role: MessageRole;
	body: string;
	created_at: string;
	/** Client-only flag set while tokens are streaming into `body`. */
	streaming?: boolean;
}

export interface StreamMeta {
	thread_id: string;
	user_message_id: string;
	assistant_message_id: string;
	title: string | null;
}

export interface StreamDone {
	assistant_message_id: string;
	body: string;
}

export type ToolEventStatus = "running" | "done";

export interface ToolEvent {
	status: ToolEventStatus;
	tool_call_id: string;
	name: string;
	source: "function" | "builtin";
	outcome?: "success" | "failed" | "denied";
}

export interface ToolActivity {
	tool_call_id: string;
	name: string;
	source: "function" | "builtin";
	status: ToolEventStatus;
	outcome?: "success" | "failed" | "denied";
}

export interface Thread {
	thread_id: string;
	title: string | null;
	messages: Message[];
}

export interface ThreadSummary {
	thread_id: string;
	title: string | null;
	created_at: string;
	updated_at: string;
}

export interface ThreadListResponse {
	threads: ThreadSummary[];
}

export interface SendMessageResponse {
	thread_id: string;
	user_message: Message;
	assistant_message: Message;
}
