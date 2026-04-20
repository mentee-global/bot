export const chatKeys = {
	all: ["chat"] as const,
	threadsRoot: () => [...chatKeys.all, "threads"] as const,
	threads: (query?: string) =>
		query
			? ([...chatKeys.all, "threads", { q: query }] as const)
			: ([...chatKeys.all, "threads"] as const),
	thread: (threadId?: string | null) =>
		threadId
			? ([...chatKeys.all, "thread", threadId] as const)
			: ([...chatKeys.all, "thread"] as const),
};
