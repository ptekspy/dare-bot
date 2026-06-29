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
  status: "pending" | "accepted" | "rejected";
  reviewedBy?: string;
  reviewedAtUtc?: number;
};

export type UserDaresResponse = {
  type: "userDares";
  username: string;
  count: number;
  dares: CompletedDare[];
};

export const ApiEndpoint = {
  UserDares: "/api/user-dares",
  OnAppInstall: "/internal/on-app-install",
  OnPlaybookPostCreate: "/internal/playbook/post-create",
  OnPlaybookPostFlairUpdate: "/internal/playbook/post-flair-update",
  OnPlaybookPostDelete: "/internal/playbook/post-delete",
  OnPlaybookBackfill: "/internal/playbook/backfill",
  OnPlaybookAccept: "/internal/playbook/accept",
  OnPlaybookReject: "/internal/playbook/reject",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];
