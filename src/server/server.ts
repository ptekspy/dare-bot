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
  type UserDaresResponse,
} from "../shared/api.ts";
import { once } from "node:events";
import {
  getUserDares,
  handleTriggerPostFlairUpdate,
  removeCompletionForDeletedPost,
  reviewPlaybookDare,
  runBackfillChunk,
  trackTriggerPostAndComment,
  type BackfillTaskData,
} from "./playbook.ts";

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
    case ApiEndpoint.UserDares:
      requireMethod(req, "GET");
      body = await onUserDares(parsedUrl);
      break;
    case ApiEndpoint.OnAppInstall:
      requireMethod(req, "POST");
      body = await onAppInstall();
      break;
    case ApiEndpoint.OnPlaybookPostCreate:
      requireMethod(req, "POST");
      body = await onPlaybookPostCreate(req);
      break;
    case ApiEndpoint.OnPlaybookPostFlairUpdate:
      requireMethod(req, "POST");
      body = await onPlaybookPostFlairUpdate(req);
      break;
    case ApiEndpoint.OnPlaybookPostDelete:
      requireMethod(req, "POST");
      body = await onPlaybookPostDelete(req);
      break;
    case ApiEndpoint.OnPlaybookBackfill:
      requireMethod(req, "POST");
      body = await onPlaybookBackfill(req);
      break;
    case ApiEndpoint.OnPlaybookAccept:
      requireMethod(req, "POST");
      body = await onReviewPlaybookDare(req, "accepted");
      break;
    case ApiEndpoint.OnPlaybookReject:
      requireMethod(req, "POST");
      body = await onReviewPlaybookDare(req, "rejected");
      break;
    default:
      endpoint satisfies never;
      body = { error: "not found", status: 404 };
      break;
  }

  writeJSON<PartialJsonValue>("status" in body ? body.status : 200, body, rsp);
}

type ApiResponse = UserDaresResponse | TriggerResponse;

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

async function onUserDares(url: URL): Promise<UserDaresResponse | ErrorResponse> {
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

  return getUserDares(username, false);
}

async function onAppInstall(): Promise<TriggerResponse> {
  return {};
}

async function onPlaybookPostCreate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = assertPostCreateEvent(await readJSON(req));
  const result = await trackTriggerPostAndComment(
    event.post,
    event.author?.name,
    event.subreddit?.name ?? event.post?.subredditName,
  );

  console.log(`Playbook post create: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookPostFlairUpdate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  console.log("Playbook post flair update trigger received");
  const event = assertPostFlairUpdateEvent(await readJSON(req));
  const result = await handleTriggerPostFlairUpdate(
    event.post,
    event.author?.name,
    event.subreddit?.name ?? event.post?.subredditName,
  );

  console.log(`Playbook post flair update: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookPostDelete(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = assertPostDeleteEvent(await readJSON(req));
  const result = await removeCompletionForDeletedPost(
    event.postId,
    event.author?.name,
    event.subreddit?.name,
  );

  console.log(`Tracked dare post delete: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookBackfill(req: IncomingMessage): Promise<TriggerResponse> {
  const event = assertBackfillTask(await readJSON(req));
  await runBackfillChunk(event.data);

  return {};
}

async function onReviewPlaybookDare(
  req: IncomingMessage,
  status: "accepted" | "rejected",
): Promise<UiResponse> {
  const event = assertMenuItemRequest(await readJSON(req));
  const result = await reviewPlaybookDare(
    event.targetId,
    status,
    context.username,
  );

  if (!result.tracked) {
    return {
      showToast: {
        text: result.reason ?? "Could not review dare.",
        appearance: "neutral",
      },
    };
  }

  return {
    showToast: {
      text: `Dare ${status}.`,
      appearance: "success",
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
    value.name !== "playbookBackfill" ||
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
