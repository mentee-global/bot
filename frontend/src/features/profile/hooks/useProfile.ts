import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	profileQueryOptions,
	profileService,
} from "#/features/profile/data/profile.service";
import type { ProfileResponse } from "#/features/profile/data/profile.types";
import { ApiError } from "#/lib/api/errors";

export function useProfileQuery() {
	return useQuery({
		...profileQueryOptions,
		retry: (failureCount, error) => {
			if (error instanceof ApiError && error.status === 401) return false;
			return failureCount < 1;
		},
	});
}

/** Save the free-text "about me". On success, seed the profile cache so the
 * page immediately reflects the saved prose. */
export function useSaveAboutMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (aboutMe: string) => profileService.saveAbout(aboutMe),
		onSuccess: (profile: ProfileResponse) => {
			queryClient.setQueryData(profileQueryOptions.queryKey, profile);
		},
	});
}
