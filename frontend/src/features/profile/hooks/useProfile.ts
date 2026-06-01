import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	profileQueryOptions,
	profileService,
} from "#/features/profile/data/profile.service";
import type {
	ProfileResponse,
	ResumeData,
} from "#/features/profile/data/profile.types";
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

/** Save + confirm the edited CV. On success, seed the profile cache so the
 * page immediately reflects the confirmed state. */
export function useSaveCvMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: ResumeData) => profileService.saveCv(data),
		onSuccess: (profile: ProfileResponse) => {
			queryClient.setQueryData(profileQueryOptions.queryKey, profile);
		},
	});
}
