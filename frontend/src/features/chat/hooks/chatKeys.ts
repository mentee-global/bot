export const chatKeys = {
	all: ["chat"] as const,
	thread: () => [...chatKeys.all, "thread"] as const,
};
