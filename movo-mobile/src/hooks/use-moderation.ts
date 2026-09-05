import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moderationClient, type ReportUserInput } from "../api/moderation-client";

/** MOVO-175, `svc-users` todavía sin implementar — ver `moderation-client.ts`. */
export function useReportUser(
  userId: string,
  options?: { onSuccess?: () => void; onError?: (error: unknown) => void }
) {
  return useMutation({
    mutationFn: (input: ReportUserInput) => moderationClient.reportUser(userId, input),
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}

export function useBlockUser(
  userId: string,
  options?: { onSuccess?: () => void; onError?: (error: unknown) => void }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => moderationClient.blockUser(userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", "public", userId] });
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}
