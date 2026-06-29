import type { CompletedDare } from "./types.ts";

export function mergeCompletion(
  existing: CompletedDare | undefined,
  incoming: CompletedDare,
): CompletedDare {
  return {
    ...existing,
    ...incoming,
    status: existing?.status && existing.status !== "pending"
      ? existing.status
      : incoming.status,
    reviewedBy: existing?.reviewedBy,
    reviewedAtUtc: existing?.reviewedAtUtc,
  };
}
