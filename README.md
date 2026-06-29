# Dare Bot

Devvit bot for tracking `r/daresgonewild` Playbook and community dare history.

The bot watches submitted posts, decides whether the post is a tracked dare from its flair, stores the result in Redis, and comments on tracked posts with the user's dare history.

## Production Behavior

The bot tracks two post flair types:

- `Playbook`: the post title must match a dare name from `https://www.reddit.com/r/daresgonewild/wiki/dares/`.
- `DARED BY`: the title or body must include a dared-by user mention such as `daredby u/example`, `dared by u/example`, or `dared-by /u/example`.

Tracked posts get a bot comment containing two history sections:

- `Playbook Dares`: wiki-matched dares from posts with the `Playbook` flair.
- `Community Dares`: user-submitted dares from posts with the `DARED BY` flair.

Each section shows the newest 5 rows in a markdown table. Older rows are rendered as spoiler lines underneath the table because Reddit comments do not support a real accordion component. Post titles are hyperlinks to the original posts.

Internal review state is stored as `pending`, `accepted`, or `rejected`, but that status is not displayed in the public table.

## Moderation Flow

Moderators get two Devvit menu actions on posts and comments:

- `Accept dare`
- `Reject dare`

These actions are available from Reddit's post/comment overflow menu, not as buttons inside the markdown table. Devvit menu actions are configured in `devvit.json`.

For `DARED BY` posts, if the bot cannot detect a `u/username` mention in the title or body, it does not add the post to history. Instead, it sends the post to the mod queue with this reason:

```txt
DARED BY flair requires a daredby u/username mention in the title or body.
```

## Event Handling

Configured triggers:

- `onPostCreate`: tracks new `Playbook` and `DARED BY` posts.
- `onPostFlairUpdate`: adds posts when a tracked flair is applied and removes posts when a tracked flair is removed.
- `onPostDelete`: removes deleted tracked posts from the user's stored history and updates existing history comments.
- `playbookBackfill` scheduler task: continues chunked historical syncs.

When a tracked post changes, the bot updates the history comments it knows about for that user. If Redis has lost the comment id, the bot attempts to recover the existing history comment from the post before creating a new one.

## Historical Sync Model

Some subreddit accounts have thousands of posts, so trigger handling does not perform a full user scan inline.

On a tracked post:

1. The new post is stored immediately.
2. The post is added to a pending comment-update set.
3. If the user has never been synced, has stale sync metadata, or appears to have lost stored completions, a chunked backfill is scheduled.
4. History tables are updated only after the backfill completes.

Backfill settings live in `src/server/playbook.ts`:

- `DEFAULT_SCAN_LIMIT = 5000`
- `BACKFILL_CHUNK_SIZE = 100`
- `USER_BACKFILL_LOCK_MS = 5 minutes`
- `USER_BACKFILL_REFRESH_MS = 7 days`

The backfill cursor uses the last returned post id as Reddit's `after` token. If the production subreddit needs more than 5000 posts per user, raise `DEFAULT_SCAN_LIMIT` after checking Devvit scheduler/runtime behavior in playtest.

## Redis Storage

The Redis namespace is controlled by `REDIS_NAMESPACE` in `src/server/playbook.ts`.

Current namespace:

```txt
playbook:v3
```

To logically reset stored bot data, bump that namespace, for example to `playbook:v4`. This does not physically delete old Redis keys; it makes the bot ignore them.

Important key groups:

- `completed:{username}`: completed dare records for a user, keyed by post id.
- `post-author:{postId}`: author index used for deletion events.
- `history-comment:{postId}`: bot history comment id for a post.
- `history-comment-post:{commentId}`: reverse lookup for mod menu actions on comments.
- `sync-meta:{username}:{subreddit}`: last completed historical sync.
- `backfill-state:{username}:{subreddit}`: current chunked sync cursor.
- `pending-history-posts:{username}:{subreddit}`: posts that should receive a table once sync finishes.

All keys are prefixed with the namespace.

## API

The app exposes one developer-facing API endpoint:

```txt
/api/user-dares?username=SomeUsername
```

Response shape:

```json
{
  "type": "userDares",
  "username": "someusername",
  "count": 1,
  "dares": [
    {
      "name": "Heartboob",
      "level": "BEGINNER LEVEL - Easy First Steps",
      "postId": "abc123",
      "title": "[Playbook] Heartboob",
      "url": "https://www.reddit.com/r/daresgonewild/comments/abc123/example/",
      "createdUtc": 1760000000,
      "flair": "Playbook",
      "author": "SomeUsername",
      "daredBy": [],
      "status": "pending"
    }
  ]
}
```

Manual rescan:

```txt
/api/user-dares?username=SomeUsername&refresh=1&limit=5000
```

Use manual refresh sparingly. It performs an immediate scan in the request path, while production trigger flow uses the safer chunked scheduler.

## Local Development

Requirements:

- Node.js `>=22.6.0`
- A Reddit/Devvit account with access to the target subreddit or playtest subreddit.

Install and authenticate:

```sh
npm install
npm run login
```

Run checks:

```sh
npm run type-check
npm test
npm run build
```

Start playtest:

```sh
npm run dev
```

The playtest subreddit is configured in `devvit.json`:

```json
{
  "dev": {
    "subreddit": "dare_bot_dev"
  }
}
```

After changing `devvit.json`, restart `npm run dev` so Devvit reloads triggers, menus, or scheduler tasks.

## Manual Test Cases

Use the playtest URL printed by `npm run dev`.

Create a Playbook post:

- Flair: `Playbook`
- Title: include a real wiki dare name, for example `[Playbook] Heartboob`
- Expected result: bot comments with the user history table after sync completes.

Create a community dare post:

- Flair: `DARED BY`
- Title or body: `Sunny day daredby u/example`
- Expected result: bot records it under `Community Dares`, with `u/example` in the `Dared by` column.

Create an invalid community dare post:

- Flair: `DARED BY`
- Title/body: no `u/username`
- Expected result: bot sends the post to mod queue and does not add it to history.

Update flair:

- Remove `Playbook` or `DARED BY` from a tracked post.
- Expected result: the post is removed from stored history and old bot comments for the user are updated.

Delete a tracked post:

- Expected result: the deleted post is removed from stored history and old bot comments for the user are updated.

Review a dare:

- Open the post or the bot history comment menu as a moderator.
- Use `Accept dare` or `Reject dare`.
- Expected result: stored status changes and history comments refresh. The public table still does not show the status column.

## Deploy

Upload the app:

```sh
npm run deploy
```

Publish the app:

```sh
npm run launch
```

`npm run launch` builds, uploads, and publishes.

## Code Map

- `src/server/playbook.ts`: public facade for the Playbook modules.
- `src/server/playbook/dare-matching.ts`: wiki markdown parsing and title matching.
- `src/server/playbook/text.ts`: normalization and `daredby u/username` extraction.
- `src/server/playbook/history-renderer.ts`: markdown table rendering.
- `src/server/playbook/completion-store.ts`: Redis persistence for completed dares.
- `src/server/playbook/sync-store.ts`: Redis persistence for backfill state and locks.
- `src/server/playbook/backfill.ts`: chunked historical sync orchestration.
- `src/server/playbook/service.ts`: trigger/menu/API orchestration.
- `src/server/server.ts`: HTTP router for Devvit triggers, menu actions, scheduler tasks, and API calls.
- `src/server/index.ts`: Devvit server bootstrap.
- `src/shared/api.ts`: shared API endpoint constants and response types.
- `devvit.json`: Devvit server, trigger, menu, scheduler, script, and playtest configuration.
- `tools/build.ts`: server-only esbuild bundle script.
- `test/playbook/*.test.ts`: Vitest coverage for parsing, matching, flair helpers, id helpers, rendering, and completion merge/key behavior.

## Operational Notes

- The wiki page is the source of truth for Playbook dare names.
- Flair matching is case-insensitive and checks whether the flair text contains `playbook` or `dared by`.
- Reddit markdown does not support real buttons or accordions inside comments; Devvit menus and spoiler lines are used instead.
- Old Redis namespaces are ignored after a namespace bump, but remain stored by Reddit/Devvit.
- Generated starter webview files were removed because this app is trigger/menu/scheduler driven.
