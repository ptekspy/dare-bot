export type TrackedItemRecord = {
  name: string;
  level: string;
  postId: string;
  title: string;
  url: string;
  createdUtc: number;
  flair: string;
  author: string;
  contributors: string[];
  status: "pending" | "accepted" | "rejected";
  reviewedBy?: string;
  reviewedAtUtc?: number;
};

export type UserItemsResponse = {
  type: "userItems" | "userDares";
  username: string;
  count: number;
  items: TrackedItemRecord[];
  dares?: TrackedItemRecord[];
};

export type CompletedDare = TrackedItemRecord;
export type UserDaresResponse = UserItemsResponse;

export const ApiEndpoint = {
  UserItems: "/api/user-dares",
  OnAppInstall: "/internal/on-app-install",
  OnTrackedPostCreate: "/internal/tracking/post-create",
  OnTrackedPostFlairUpdate: "/internal/tracking/post-flair-update",
  OnTrackedPostDelete: "/internal/tracking/post-delete",
  OnTrackedBackfill: "/internal/tracking/backfill",
  OnTrackedAccept: "/internal/tracking/approve",
  OnTrackedReject: "/internal/tracking/reject",
  OnTrackingEnableContributors: "/internal/tracking/enable-contributors",
  OnTrackingDisableContributors: "/internal/tracking/disable-contributors",
  OnTrackingRemoveFlair: "/internal/tracking/remove-flair",
  OnTrackingSyncRules: "/internal/tracking/sync-rules",
  // Compatibility endpoint keys.
  UserDares: "/api/user-dares",
  OnPlaybookPostCreate: "/internal/tracking/post-create",
  OnPlaybookPostFlairUpdate: "/internal/tracking/post-flair-update",
  OnPlaybookPostDelete: "/internal/tracking/post-delete",
  OnPlaybookBackfill: "/internal/tracking/backfill",
  OnPlaybookAccept: "/internal/tracking/approve",
  OnPlaybookReject: "/internal/tracking/reject",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
