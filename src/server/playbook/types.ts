export type ReviewStatus = "pending" | "accepted" | "rejected";

export type Dare = {
  name: string;
  level: string;
  aliases: string[];
};

export type CompletedDare = {
  name: string;
  level: string;
  postId: string;
  title: string;
  url: string;
  createdUtc: number;
  flair: string;
  author: string;
  daredBy: string[];
  status: ReviewStatus;
  reviewedBy?: string;
  reviewedAtUtc?: number;
};

export type ScanUserResult = {
  type: "userDares";
  username: string;
  count: number;
  dares: CompletedDare[];
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
  dare?: CompletedDare;
};

export type UntrackPostResult = {
  untracked: boolean;
  reason?: string;
};

export type CompletionEntry = {
  key: string;
  dare: CompletedDare;
};
