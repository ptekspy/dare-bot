import type { IncomingMessage, ServerResponse } from "node:http";
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

export async function serverOnRequest(
  req: IncomingMessage,
  rsp: ServerResponse,
): Promise<void> {
  try {
    await onRequest(req, rsp);
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`;
    console.error(msg);
    writeJSON<ErrorResponse>(500, { error: msg, status: 500 }, rsp);
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

  let body: ApiResponse | UiResponse | ErrorResponse;
  switch (endpoint) {
    case ApiEndpoint.UserDares:
      body = await onUserDares(parsedUrl);
      break;
    case ApiEndpoint.OnAppInstall:
      body = await onAppInstall();
      break;
    case ApiEndpoint.OnPlaybookPostCreate:
      body = await onPlaybookPostCreate(req);
      break;
    case ApiEndpoint.OnPlaybookPostFlairUpdate:
      body = await onPlaybookPostFlairUpdate(req);
      break;
    case ApiEndpoint.OnPlaybookPostDelete:
      body = await onPlaybookPostDelete(req);
      break;
    case ApiEndpoint.OnPlaybookBackfill:
      body = await onPlaybookBackfill(req);
      break;
    case ApiEndpoint.OnPlaybookAccept:
      body = await onReviewPlaybookDare(req, "accepted");
      break;
    case ApiEndpoint.OnPlaybookReject:
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

async function onUserDares(url: URL): Promise<UserDaresResponse | ErrorResponse> {
  const username = url.searchParams.get("username");
  if (!username) {
    return {
      error: "missing required query parameter: username",
      status: 400,
    };
  }

  const refresh = url.searchParams.get("refresh") === "1";
  const rawLimit = Number(url.searchParams.get("limit") ?? 1000);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 5000)
    : 5000;

  return getUserDares(username, refresh, limit);
}

async function onAppInstall(): Promise<TriggerResponse> {
  return {};
}

async function onPlaybookPostCreate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = await readJSON<OnPostCreateRequest>(req);
  const result = await trackTriggerPostAndComment(
    event.post,
    event.author?.name,
    event.subreddit?.name,
  );

  console.log(`Playbook post create: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookPostFlairUpdate(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = await readJSON<OnPostFlairUpdateRequest>(req);
  const result = await handleTriggerPostFlairUpdate(
    event.post,
    event.author?.name,
    event.subreddit?.name,
  );

  console.log(`Playbook post flair update: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookPostDelete(
  req: IncomingMessage,
): Promise<TriggerResponse> {
  const event = await readJSON<OnPostDeleteRequest>(req);
  const result = await removeCompletionForDeletedPost(
    event.postId,
    event.author?.name,
  );

  console.log(`Tracked dare post delete: ${JSON.stringify(result)}`);
  return {};
}

async function onPlaybookBackfill(req: IncomingMessage): Promise<TriggerResponse> {
  const event = await readJSON<SchedulerTaskRequest<BackfillTaskData>>(req);
  await runBackfillChunk(event.data);

  return {};
}

async function onReviewPlaybookDare(
  req: IncomingMessage,
  status: "accepted" | "rejected",
): Promise<UiResponse> {
  const event = await readJSON<MenuItemRequest>(req);
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

async function readJSON<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  return JSON.parse(`${Buffer.concat(chunks)}`);
}
