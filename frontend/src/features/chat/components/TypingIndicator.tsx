/**
 * Three-dot "thinking" animation shown in the assistant bubble while the
 * model is processing and hasn't produced any text yet.
 */
export function TypingIndicator() {
	return (
		<span
			role="status"
			aria-label="Mentor is thinking"
			className="flex items-center gap-1 py-1"
		>
			<span className="typing-dot" />
			<span className="typing-dot [animation-delay:150ms]" />
			<span className="typing-dot [animation-delay:300ms]" />
		</span>
	);
}
