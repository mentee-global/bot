import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	authService,
	sessionQueryOptions,
} from "#/features/auth/data/auth.service";

export function useSession() {
	return useQuery(sessionQueryOptions);
}

export function useLogoutMutation() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	return useMutation({
		mutationFn: authService.logout,
		onSuccess: () => {
			queryClient.setQueryData(sessionQueryOptions.queryKey, null);
			queryClient.invalidateQueries({ queryKey: ["chat"] });
			navigate({ to: "/" });
		},
	});
}
