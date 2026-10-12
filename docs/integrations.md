# Integrations

Chat has three ways for other software to take part in conversations:

- **Webhooks** post into one channel from a secret URL. They take Discord's, Slack's and GitHub's formats, so most tools work without code.
- **Apps** (bots) are accounts your own code controls. They read and post through the API, hear messages and slash commands at an events URL, and can add buttons to their messages.
- **GitHub** has a built-in integration. It uses a GitHub App that the server owner creates in one step. It lets channels follow repositories, previews issue and pull request links, and adds buttons that close and reopen issues.

Messages from all three carry an **App** badge, so nobody mistakes them for a person.

## Webhooks

Someone with the **Manage integrations** permission creates a webhook in Workspace settings → Integrations. They pick its name and channel. The URL and secret are shown once. They can be replaced at any time, which stops the old ones working at once.

Every webhook has three URLs:

| URL | Takes |
| --- | --- |
| `https://chat.example.com/api/webhooks/<id>/<token>` | Discord's execute-webhook body |
| `…/slack` | Slack's incoming webhook body |
| `…/github` | GitHub's webhook deliveries, signed with the webhook's secret |

### Discord format

```bash
curl -X POST "https://chat.example.com/api/webhooks/ID/TOKEN?wait=true" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Deployed **v1.4** to production",
    "username": "CI",
    "avatar_url": "https://example.com/ci.png",
    "embeds": [{
      "title": "Build 42",
      "url": "https://ci.example.com/42",
      "color": 2067261,
      "fields": [{ "name": "Branch", "value": "main", "inline": true }],
      "footer": { "text": "ci.example.com" },
      "timestamp": "2026-09-28T10:00:00Z"
    }]
  }'
```

- `content` is Markdown, up to 2,000 characters. `username` and `avatar_url` apply to this message only.
- `embeds` follows Discord's embed object: `title`, `url`, `description`, `color`, `timestamp`, `author`, `footer`, `fields`, `image`, `thumbnail`. Up to 10 cards and 6,000 characters in total. Anything invalid is dropped rather than refused.
- `allowed_mentions: { "parse": [] }` stops the message notifying anyone it names. A webhook can only mention @everyone if the person who created it could.
- Files: send `multipart/form-data` with the JSON in `payload_json` and the files as `files[0]`, `files[1]` and so on. Up to 10 files of 25 MB each.
- `?wait=true` returns the message. Without it the answer is `204 No Content`.
- `?thread_id=<message id>` posts into that message's thread.
- `PATCH` and `DELETE` on `…/messages/<message id>` edit or delete the webhook's own messages. `GET` on the URL describes the webhook, and `DELETE` on it deletes the webhook.
- Errors use Discord's shape, `{ "message": "…", "code": 50006 }`. Each webhook may post 30 messages a minute. Past that it gets `429` with `retry_after`.

### Slack format

`text` (Slack mrkdwn), `blocks` (sections, headers, fields and context become text), `attachments` (each becomes a card), `username` and `icon_url`. Slack's link syntax `<https://example.com|label>` and its `*bold*` and `~strike~` become Markdown.

### GitHub deliveries

In a repository or organisation, open **Settings → Webhooks → Add webhook**. Use the `…/github` URL as the Payload URL, pick `application/json`, and paste the webhook's secret. Choose events on GitHub's side. Deliveries whose signature doesn't match are refused with `401`, and GitHub shows why under Recent Deliveries. Redeliveries don't post twice.

Posted events include pushes, pull requests (opened, ready for review, merged, closed, reopened) and reviews. Issues (opened, closed, reopened), comments, releases, failed Actions runs, branches and tags, stars and forks are posted too. Noisy actions like labelling or new commits on a pull request are skipped. Text from GitHub never notifies anyone here.

## Apps (bots)

The **server owner** creates apps in Settings → Server → Apps and gets two credentials, shown once:

- a **token** for the API: `Authorization: Bot <token>`
- a **signing secret** for checking deliveries to the app's events URL

A workspace admin with **Manage integrations** adds an app in Workspace settings → Integrations. It then appears in the member list under Apps. Give it roles like anyone else: channel overrides decide what it can read and where it can post. It starts with @everyone's permissions. An app can read every message in the channels it can see, so add only apps you trust.

### The API

Apps use the same REST API as the web app, limited to these routes:

| Method | Path |
| --- | --- |
| GET | `/api/me`, `/api/me/workspaces` |
| GET | `/api/workspaces/:id`, `/api/workspaces/:id/members`, `/api/workspaces/:id/roles` |
| GET | `/api/channels/:id`, `/api/channels/:id/messages`, `/api/channels/:id/messages/:messageId`, `/api/channels/:id/pins` |
| POST | `/api/channels/:id/messages` |
| PATCH, DELETE | `/api/channels/:id/messages/:messageId` |
| PUT, DELETE | `/api/channels/:id/messages/:messageId/pin` |
| PUT | `/api/channels/:id/messages/:messageId/reactions` with `{ "emoji": "👍" }` |
| DELETE | `/api/channels/:id/messages/:messageId/reactions/:emoji` |
| POST, PUT | `/api/uploads/authorize`, `/api/uploads/put/:id`, `/api/uploads/complete` |
| GET | `/api/files/…` |
| GET | `/api/bots/@me` |
| GET, PUT | `/api/bots/@me/commands` |

Everything else answers `403`: settings, invites, direct messages, accounts and realtime sockets. Apps get 120 requests a minute.

An app's message can carry cards (`embeds`, same shape as above, in camelCase or Discord's snake_case) and buttons (`components`):

```json
{
  "content": "Ship v1.4 to production?",
  "embeds": [{ "title": "v1.4", "description": "3 changes since v1.3", "color": 8540127 }],
  "components": [
    {
      "type": "row",
      "components": [
        { "type": "button", "style": "success", "label": "Ship it", "customId": "ship:v1.4" },
        { "type": "button", "style": "link", "label": "See the diff", "url": "https://github.com/acme/app/compare/v1.3...v1.4" }
      ]
    }
  ]
}
```

Button styles are `primary`, `secondary`, `success`, `danger` and `link`. A link button opens its `url`. The others send their `customId` to the app. There can be up to 5 rows of 5 buttons. `clientMessageId` is optional for apps; send one to make retries safe.

### Events

Save an events URL in the app's settings. Saving sends a `ping`, which must get a 2xx answer within five seconds. From then on the app receives these as `POST` requests:

| `type` | `data` |
| --- | --- |
| `message.created`, `message.updated` | `{ message }` |
| `message.deleted` | `{ messageId, sequence }` |
| `reaction.updated` | `{ messageId, reactions }` |
| `member.joined` | `{ user }` |
| `member.left` | `{ user, reason }`, reason being `left`, `kicked` or `banned` |
| `interaction` | a slash command or button press; see below |

Every body also has `id`, `workspaceId`, `channelId` and `createdAt`. An app only hears channels it can see, and never its own messages. Events arrive through a queue, so they may be late, out of order or repeated; `id` identifies each one.

Check each delivery before trusting it:

```js
async function verify(request, signingSecret) {
  const body = await request.text();
  const timestamp = request.headers.get("X-Chat-Timestamp");
  const signature = request.headers.get("X-Chat-Signature"); // "sha256=<hex>"
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signature === expected ? JSON.parse(body) : null;
}
```

A failed delivery is retried three times. After ten failed deliveries in a row, events pause and the owner sees why in Settings. Saving the URL again resumes them.

### Slash commands

Register commands with a `PUT` that replaces the whole list:

```bash
curl -X PUT https://chat.example.com/api/bots/@me/commands \
  -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
  -d '[{ "name": "deploy", "description": "Deploy a branch", "usage": "<environment>" }]'
```

Names are 1 to 32 lowercase letters, numbers, `-` and `_`, and an app can have up to 50. `/github` is taken. Commands appear in the composer when someone types `/`, in every workspace the app is in. When someone runs `/deploy production`, the app receives:

```json
{
  "id": "…", "type": "interaction", "token": "…",
  "workspaceId": "…", "channelId": "…", "createdAt": "…",
  "data": {
    "kind": "command", "command": "deploy", "text": "production",
    "user": { "id": "…", "username": "walt", "displayName": "Walt", "avatarUrl": null },
    "member": { "nickname": null, "roleIds": ["…"] },
    "channel": { "id": "…", "name": "deploys" }
  }
}
```

A button press has `"kind": "button"`, `customId`, and the `message` it's on. The app must answer within **three seconds** with one of:

- `{ "type": "message", "content": "…", "embeds": [], "components": [], "ephemeral": false }` posts in the channel, headed "Walt used /deploy".
- The same with `"ephemeral": true` shows only to the person who ran it. It isn't stored and is gone when they reload.
- `{ "type": "update", "content": "…", "components": [] }`, for a button, replaces the message the button is on.
- `{ "type": "defer" }` or an empty 2xx body means the app will answer later.

Later answers, or extra ones, go to `POST /api/interactions/<id>/<token>/respond` with the same body. That call needs no other authentication and works for 15 minutes.

The example in `examples/bot-worker` is a complete app that runs as a Cloudflare Worker.

## GitHub App

The server owner creates it in **Settings → Server → GitHub**. It can belong to them or to an organisation. GitHub asks them to confirm the app's name and permissions, then sends them back. The app's private key, webhook secret and OAuth credentials are stored encrypted. Then they install the app on the accounts or organisations whose repositories should post here.

After that:

- **Subscriptions.** People with Manage integrations subscribe a channel in Workspace settings → Integrations, or by typing in the channel:
  - `/github subscribe owner/repo` posts issues, pull requests, commits, releases and failed workflow runs.
  - `/github subscribe owner/repo issues pulls reviews comments` posts exactly those. The features are `issues`, `pulls`, `commits`, `releases`, `reviews`, `comments`, `workflows` and `branches`.
  - `/github unsubscribe owner/repo` stops it, and `/github list` shows what the channel follows.
- **Buttons.** Posts about issues and pull requests carry Close and Reopen buttons. They act on GitHub as whoever presses them, so each person links their GitHub account once, in Settings → Profile. GitHub decides whether they're allowed.
- **Link previews.** Links to issues and pull requests show their title, state, author and labels, including in private repositories the app is installed on.

Without the GitHub App, a webhook's `/github` URL still works for any repository.

## Link previews and images

Links in messages get a preview card with the page's title, description and image. Wrap a link in `<>` to skip its preview. The server fetches each page, so readers never contact it. The owner can turn previews off in Settings → Server.

Images in cards, previews and webhook avatars load through `/api/media` on this server. It only serves URLs the server signed, never serves SVG, and caps images at 10 MB.
