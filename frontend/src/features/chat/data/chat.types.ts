export type MessageRole = "user" | "assistant";

export interface Message {
	id: string;
	thread_id: string;
	role: MessageRole;
	body: string;
	created_at: string;
}

export interface Thread {
	thread_id: string;
	messages: Message[];
}

export interface SendMessageResponse {
	thread_id: string;
	user_message: Message;
	assistant_message: Message;
}
