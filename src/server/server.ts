import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { context } from "@devvit/web/server";
import type {
  MenuItemRequest,
  OnPostCreateRequest,
  OnPostDeleteRequest,
  OnPostFlairUpdateRequest,
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from "@devvit/web/shared";
import {
  ApiEndpoint,
  type UserItemsResponse,
} from "../shared/api.ts";
import { once } from "node:events";
import {
  configureTrackedFlairFromPost,
  getUserItems,
  handleTriggerPostFlairUpdate,
  removeCompletionForDeletedPost,
  removeTrackedFlairFromPost,
  reviewTrackedItem,
  runBackfillChunk,
  syncTrackedFlairRules,
  trackTriggerPostAndComment,
  type BackfillTaskData,
} from "./tracking.ts";

const MAX_JSON_BODY_BYTES = 128 * 1024;

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const requestId = randomUUID();
    console.error(
      `server error ${requestId}; ${err instanceof Error ? err.stack : err}`,
    );
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "internal server error";
    writeJSON<ErrorResponse>(status, { error: message, status }, rsp);
  }
}

async function onRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  const url = req.url;

  if (!url || url === "/") {
    writeJSON<ErrorResponse>(404, { error: "not found", status: 404 }, rsp);
    return;
  }

  const parsedUrl = new URL(url, "https://devvit.local");
  const endpoint = parsedUrl.pathname as ApiEndpoint;
  if (endpoint.startsWith("/internal/")) {
    console.log(`Incoming internal request: ${(req.method ?? "GET").toUpperCase()} ${endpoint}`);
  }

  let body: ApiResponse | UiResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.UserItems:
      requireMethod(req, "GET");
      body = await onUserItems(parsedUrl);
      break;
    case ApiEndpoint.OnAppInstall:
      requireMethod(req, "POST");
      body = await onAppInstall();
      break;
    case ApiEndpoint.OnTrackedPostCreate:
      requireMethod(req, "POST");
      body = await onTrackedPostCreate(req);
      break;
    case ApiEndpoint.OnTrackedPostFlairUpdate:
      requireMethod(req, "POST");
      body = await onTrackedPostFlairUpdate(req);
      break;
    case ApiEndpoint.OnTrackedPostDelete:
      requireMethod(req, "POST");
      body = await onTrackedPostDelete(req);
      break;
    case ApiEndpoint.OnTrackedBackfill:
      requireMethod(req, "POST");
      body = await onTrackedBackfill(req);
      break;
    case ApiEndpoint.OnTrackedAccept:
      requireMethod(req, "POST");
      body = await onReviewTrackedItem(req, "accepted");
      break;
    case ApiEndpoint.OnTrackedReject:
      requireMethod(req, "POST");
      body = await onReviewTrackedItem(req, "rejected");
      break;
    case ApiEndpoint.OnTrackingEnableContributors:
      requireMethod(req, "POST");
      body = await onConfigureTrackingFromPost(req, true);
      break;
    case ApiEndpoint.OnTrackingDisableContributors:
      requireMethod(req, "POST");
      body = await onConfigureTrackingFromPost(req, false);
      break;
    case ApiEndpoint.OnTrackingRemoveFlair:
      requireMethod(req, "POST");
      body = await onRemoveTrackingFromPost(req);
      break;
    case ApiEndpoint.OnTrackingSyncRules:
      requireMethod(req, "POST");
      body = await onSyncTrackingRules();
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ApiResponse = UserItemsResponse | TriggerResponse;

type ErrorResponse = {
  error: string;
  status: number;
};

type SchedulerTaskRequest<T> = {
  name: string;
  data: T;
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function onUserItems(url: URL): Promise<UserItemsResponse | ErrorResponse> {
  const username = url.searchParams.get("username");
  if (!username) {
    return {
      error: "missing required query parameter: username",
      status: 400,
    };
  }

  if (url.searchParams.has("refresh")) {
    return {
      error: "manual refresh is disabled on the public API",
      status: 403,
    };
  }

  return getUserItems(username, false);
}

async function onAppInstall(): Promise<TriggerResponse> {
  return {};
}

async function onTrackedPostCreate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = assertPostCreateEvent(await readJSON(req));
  const result = await trackTriggerPostAndComment(
    event.post,
    event.author?.name,
    event.subreddit?.name ?? event.post?.subredditName,
  );

  console.log(`Tracked post create: ${JSON.stringify(result)}`);
  return {};
}

async function onTrackedPostFlairUpdate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  console.log("Tracked post flair update trigger received");
  const event = assertPostFlairUpdateEvent(await readJSON(req));
  const result = await handleTriggerPostFlairUpdate(
    event.post,
    event.author?.name,
    event.subreddit?.name ?? event.post?.subredditName,
  );

  console.log(`Tracked post flair update: ${JSON.stringify(result)}`);
  return {};
}

async function onTrackedPostDelete(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = assertPostDeleteEvent(await readJSON(req));
  const result = await removeCompletionForDeletedPost(
    event.postId,
    event.author?.name,
    event.subreddit?.name,
  );

  console.log(`Tracked post delete: ${JSON.stringify(result)}`);
  return {};
}

async function onTrackedBackfill(req: IncomingMessage): Promise<TriggerResponse> {
  const event = assertBackfillTask(await readJSON(req));
  await runBackfillChunk(event.data);

  return {};
}

async function onReviewTrackedItem(
  req: IncomingMessage,
  status: "accepted" | "rejected",
): Promise<UiResponse> {
  const event = assertMenuItemRequest(await readJSON(req));
  const result = await reviewTrackedItem(
    event.targetId,
    status,
    context.username,
  );

  if (!result.tracked) {
    return {
      showToast: {
        text: result.reason ?? "Could not review item.",
        appearance: "neutral",
      },
    };
  }

  return {
    showToast: {
      text: `Tracked item ${status}.`,
      appearance: "success",
    },
  };
}

async function onConfigureTrackingFromPost(
  req: IncomingMessage,
  trackContributors: boolean,
): Promise<UiResponse> {
  const event = assertMenuItemRequest(await readJSON(req));
  const result = await configureTrackedFlairFromPost(
    event.targetId,
    trackContributors,
    undefined,
    context.username,
  );

  return {
    showToast: {
      text: result.reason,
      appearance: result.ok ? "success" : "neutral",
    },
  };
}

async function onRemoveTrackingFromPost(
  req: IncomingMessage,
): Promise<UiResponse> {
  const event = assertMenuItemRequest(await readJSON(req));
  const result = await removeTrackedFlairFromPost(
    event.targetId,
    context.username,
  );

  return {
    showToast: {
      text: result.reason,
      appearance: result.ok ? "success" : "neutral",
    },
  };
}

async function onSyncTrackingRules(): Promise<UiResponse> {
  const result = await syncTrackedFlairRules(context.username);
  return {
    showToast: {
      text: result.reason,
      appearance: result.ok ? "success" : "neutral",
    },
  };
}

function requireMethod(req: IncomingMessage, method: string): void {
  if ((req.method ?? "GET").toUpperCase() !== method) {
    throw new HttpError(405, "method not allowed");
  }
}

function writeJSON<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json);
  const len = Buffer.byteLength(body);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(body);
}

async function readJSON(req: IncomingMessage): Promise<unknown> {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "request body too large");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  req.on("data", (chunk: Uint8Array) => {
    total += chunk.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  await once(req, "end");
  if (tooLarge) {
    throw new HttpError(413, "request body too large");
  }
  try {
    return JSON.parse(`${Buffer.concat(chunks)}`);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasName(value: unknown): value is { name: string } {
  return isRecord(value) && typeof value.name === "string";
}

function hasPostPayload(value: unknown): value is {
  id: string;
  title?: string;
  permalink?: string;
  createdAt?: number;
  linkFlair?: { text?: string };
  selftext?: string;
  subredditName?: string;
} {
  return (
    isRecord(value) &&
    typeof value.id === "string"
  );
}

function assertPostCreateEvent(value: unknown): OnPostCreateRequest {
  if (!isRecord(value) || !hasPostPayload(value.post)) {
    throw new HttpError(400, "invalid post create payload");
  }
  return value as OnPostCreateRequest;
}

function assertPostFlairUpdateEvent(value: unknown): OnPostFlairUpdateRequest {
  if (!isRecord(value) || !hasPostPayload(value.post)) {
    throw new HttpError(400, "invalid post flair update payload");
  }
  return value as OnPostFlairUpdateRequest;
}

function assertPostDeleteEvent(value: unknown): OnPostDeleteRequest {
  if (
    !isRecord(value) ||
    typeof value.postId !== "string" ||
    !hasName(value.subreddit)
  ) {
    throw new HttpError(400, "invalid post delete payload");
  }
  return value as OnPostDeleteRequest;
}

function assertBackfillTask(
  value: unknown,
): SchedulerTaskRequest<BackfillTaskData> {
  if (
    !isRecord(value) ||
    value.name !== "trackingBackfill" ||
    !isRecord(value.data) ||
    typeof value.data.username !== "string" ||
    typeof value.data.subredditName !== "string"
  ) {
    throw new HttpError(400, "invalid backfill payload");
  }
  return value as SchedulerTaskRequest<BackfillTaskData>;
}

function assertMenuItemRequest(value: unknown): MenuItemRequest {
  if (
    !isRecord(value) ||
    (value.location !== "post" && value.location !== "comment") ||
    typeof value.targetId !== "string"
  ) {
    throw new HttpError(400, "invalid menu payload");
  }

  return value as MenuItemRequest;
}
