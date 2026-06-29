export type ItemReviewStatus = "pending" | "accepted" | "rejected";

export type TrackedItem = {
  name: string;
  level: string;
  aliases: string[];
};

export type TrackedFlairRuleSource = "default" | "wiki" | "manual";

export type TrackedFlairRule = {
  flairText: string;
  normalizedFlairText: string;
  trackContributors: boolean;
  wikiLink?: string;
  source: TrackedFlairRuleSource;
};

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
  status: ItemReviewStatus;
  reviewedBy?: string;
  reviewedAtUtc?: number;
};

export type UserItemsResult = {
  type: "userItems" | "userDares";
  username: string;
  count: number;
  items: TrackedItemRecord[];
  dares?: TrackedItemRecord[];
};

export type UserSyncMeta = {
  username: string;
  subredditName?: string;
  lastFullSyncAtUtc: number;
  lastFullSyncLimit: number;
  completionCount: number;
};

export type BackfillTaskData = {
  username: string;
  subredditName?: string;
};

export type BackfillState = BackfillTaskData & {
  after?: string;
  limit: number;
  processed: number;
};

export type TrackPostResult = {
  tracked: boolean;
  reason?: string;
  item?: TrackedItemRecord;
  dare?: TrackedItemRecord;
};

export type UntrackPostResult = {
  untracked: boolean;
  reason?: string;
};

export type CompletionEntry = {
  key: string;
  item: TrackedItemRecord;
  dare?: TrackedItemRecord;
};

// Compatibility aliases while callsites migrate to neutral names.
export type ReviewStatus = ItemReviewStatus;
export type Dare = TrackedItem;
export type CompletedDare = TrackedItemRecord;
export type ScanUserResult = UserItemsResult;
