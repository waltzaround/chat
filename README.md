# Chat

Repository: https://github.com/waltzaround/beacon

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/waltzaround/beacon)

A Discord-style community chat application you can run yourself, built entirely on Cloudflare: Workers, Durable Objects (WebSocket Hibernation), D1, R2, Queues, RealtimeKit, Turnstile and Workers Analytics Engine — with a Vite + React front end served from Workers Static Assets.

Workspaces contain categories, text channels, voice channels (with their own chat), members, roles with a permission bitfield, channel permission overwrites, invites, bans and an audit log. Text chat is realtime over one WebSocket per workspace; voice, video and screen sharing run on Cloudflare RealtimeKit with a fully custom media UI.

## Run your own server

You need a Cloudflare account (the free plan is enough). If you don't have one, both options below let you sign up along the way. There is nothing to configure: the app generates its own auth secret and works on whatever URL it is deployed to.

### Option 1: Deploy button (nothing to install)

1. Click [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/waltzaround/beacon). Log in, or choose **Sign up**.
2. Connect GitHub or GitLab. Cloudflare copies this repo into your account there and creates the database, storage bucket, and queue in your Cloudflare account.
3. Leave every setting blank except `OWNER_CLAIM_TOKEN`: put any long random phrase there. Click **Deploy**.
4. Open `https://….workers.dev/register?claim=<your phrase>`. Create your owner account, name your workspace, and share the invite link it gives you.

The first account on a server becomes its **owner**. With `OWNER_CLAIM_TOKEN` set, only your claim link can create that account. If you leave it blank, whoever signs up first becomes the owner, so open the URL straight away.

If the deploy stops with an R2 error, open **R2** in the Cloudflare dashboard once to enable it (the free tier is enough, but Cloudflare asks for a payment method), then retry.

### Option 2: From your terminal

Needs Node.js 22 or newer and git.

```bash
git clone https://github.com/waltzaround/beacon.git && cd beacon
npm install
npm run setup
```

`setup` opens a browser to log in (or sign up) to Cloudflare, asks for a Worker name, and shows a plan before it does anything. Then it creates the database, bucket, and queue, creates a Turnstile widget that protects sign-up, deploys, and prints a one-time link for creating your owner account. Nobody else can create the first account. If the account is new, it also registers a `workers.dev` subdomain and walks you through enabling R2.

Running it again is safe. Existing resources are kept, and it is how you add the extras below. `npm run setup -- --yes` accepts every default without prompting, and `--help` lists the flags.

### Add extras later

None of these are needed for chat. Run `npm run setup` again and answer **yes** to extras. You can also put the values in the environment or pass `--env-file`, then run `npm run setup -- --yes`.

| Extra | What you need |
| --- | --- |
| Voice, video, and screen sharing | A RealtimeKit app (dashboard → Realtime → RealtimeKit): its app id and an API token with Realtime permissions. Setup creates the two presets. Until then, voice rooms show "Voice is not configured on this deployment". |
| Google or GitHub sign-in | An OAuth client id and secret. Callback URLs are `https://YOUR-URL/api/auth/callback/google` and `/api/auth/callback/github`. |
| Direct-to-R2 uploads | An R2 API token (Object Read & Write): `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. Without it, the Worker proxies uploads. Setup configures bucket CORS for you. |
| Password-reset email | **Needs the Workers Paid plan ($5/month); not available on the free plan.** You also need your own domain on Cloudflare DNS, set up under Email → Email Sending in the dashboard. Setup asks for a sender address such as `chat@yourdomain.com` and adds the `send_email` binding. Without email, use the recovery options below. |
| Custom domain | Add it to the Worker in the dashboard (Settings → Domains & Routes), then run `npm run setup -- --app-url https://chat.example.com` so Turnstile and upload CORS allow it too. |

If you used the deploy button, set the same values as Worker secrets in the dashboard (Settings → Variables and Secrets). For voice, also run `npm run realtimekit:presets` once from a clone. For email, set the `EMAIL_FROM` variable and add `"send_email": [{ "name": "EMAIL" }]` to `wrangler.jsonc` in your copy of the repo.

### Forgotten passwords

Every server can recover accounts, with or without email:

| Who | How |
| --- | --- |
| A member | The owner opens User Settings → Server, finds the account, and clicks **Reset link**. They send that one-time link privately; it works once and expires in 24 hours. |
| The owner | From the folder you ran setup in, run `npm run recover` (add `--email someone@example.com` for any other account). It uses your Cloudflare login and prints a reset link. |
| Anyone, by email | "Forgot password?" on the sign-in page sends a reset link. This needs email set up, which needs the **Workers Paid plan**. On the free plan, the page tells people to ask the owner. |

Setting a new password signs that account out on its other devices. Sessions are cached in a cookie for up to 5 minutes, so an old device can stay signed in that long.

## Stack

| Layer | Choice |
| --- | --- |
| Front end | Vite 8, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Lucide, React Router 7, TanStack Query 5, TanStack Virtual |
| Worker API | Hono, Zod, Drizzle ORM (D1), Better Auth (D1 via Drizzle adapter) |
| Realtime | `WorkspaceHub` Durable Object per workspace, WebSocket Hibernation API |
| Media | `@cloudflare/realtimekit` + `@cloudflare/realtimekit-react` (Core SDK, custom UI) |
| Storage | D1 (relational + FTS5 search), R2 (private uploads via presigned PUT), Durable Object storage (per-channel sequence counters) |
| Background | Queues (attachment processing, cleanup, invite expiry), cron trigger |
| Security | Turnstile, per-IP/user rate limits, CSP + security headers, server-side permission resolution |
| Analytics | Workers Analytics Engine (operational events only, never message bodies) |

## Repository layout

```
src/            React app (app shell, routes, components, realtime client, voice)
worker/         Worker: Hono API, auth, permissions, Durable Object, uploads, queues, analytics
shared/         Types, Zod schemas, WebSocket protocol and permission bitfield shared by both sides
db/             Drizzle schema, D1 migrations (incl. FTS5), demo seed
test/           Vitest (Workers pool): unit, API and realtime integration tests
scripts/        RealtimeKit preset setup, Playwright smoke test
public/         Static assets and `_headers` (CSP for the SPA)
```

## Local development

```bash
git clone https://github.com/waltzaround/beacon.git && cd beacon
npm install
npm run db:migrate                  # applies db/migrations to the local D1
npm run db:seed                     # optional demo data (see below)
npm run dev                         # http://localhost:5173
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc -b` across app, worker and node configs |
| `npm test` | Vitest inside the Workers runtime (`@cloudflare/vitest-pool-workers`) |
| `npm run db:generate` | Regenerate a migration from `db/schema.ts` |
| `npm run db:migrate` / `db:migrate:remote` | Apply migrations locally / to the deployed D1 |
| `npm run db:seed` | Generate `db/seed.sql` and load it into local D1 |
| `npm run realtimekit:presets` | Create the two RealtimeKit presets the app expects |
| `npm run setup` | Create the Cloudflare resources and deploy (see [Run your own server](#run-your-own-server)) |
| `npm run update` | Bring this copy up to date with upstream (see [Updating](#updating)) |
| `npm run backup` / `restore` | Save the database to `backups/`, or load a backup into an empty database |
| `npm run recover` | Print a one-time password-reset link for the owner (or `--email` any account); `--local` for the dev database |
| `npm run deploy` | `vite build`, apply remote D1 migrations, then `wrangler deploy` |
| `node scripts/e2e-smoke.mjs` | Browser smoke test against a running dev server (needs `npx playwright install chromium`) |

### Demo seed

`npm run db:seed` creates the **Acme Community** workspace with categories General / Projects / Voice, text channels `general`, `random`, `design`, `engineering`, voice channels Lounge, Design Room, Engineering Room, five members, ~45 messages, reactions and a permanent invite at `/invite/acmedemo`.

Demo logins (password `password123`): `walter@example.com` (owner), `sarah@example.com`, `james@example.com`, `priya@example.com`, `diego@example.com`.

The production app has no dependency on seed data.

No `.dev.vars` is needed. To add optional secrets locally (OAuth, voice), copy `.dev.vars.example` to `.dev.vars` and fill in what you need.

### What works locally without Cloudflare credentials

Everything except voice/video: auth (email/password), workspaces, channels, realtime chat, presence, typing, reactions, uploads (proxied through the Worker into the local R2 emulator), search and administration all run locally through the Cloudflare Vite plugin (Miniflare). Turnstile is skipped when `TURNSTILE_SECRET_KEY` is empty and a warning is logged once.

Voice needs a RealtimeKit app (see below). Until the three RealtimeKit secrets are set, joining a voice room shows an explicit "Voice is not configured on this deployment" message rather than failing silently.

## Running your server

### Owner setup and who can join

Your first sign-up is a three-step setup: create your account, name your workspace, and invite people. The last step gives you a permanent invite link and asks who can create accounts:

- **Invite only** (the default for new servers). People need an invite link from any workspace to sign up. This covers Google/GitHub sign-up too.
- **Anyone with the URL.** Open sign-up, protected by Turnstile and rate limits.

The owner can change this later under User Settings → Server. Servers that already had accounts before this feature treat their earliest account as the owner and stay open.

### Updating

Run `npm run update` in your copy, review the changes, then deploy. Database migrations run as part of every deploy.

- **A git clone of this repo** (the terminal setup): `npm run update` runs `git pull --autostash`, which keeps your uncommitted database id. Then run `npm run deploy`.
- **A deploy-button copy**: it has no shared history with this repo, so `npm run update` downloads the latest version and lays it over your copy. Your own `wrangler.jsonc` values are kept (names, database id, Turnstile key, email settings), and files deleted upstream are removed. The included **Update from upstream** GitHub Action does this every Monday, or on demand from the Actions tab, and opens a pull request. Merging it redeploys. If the Action can't open the pull request, turn on *Allow GitHub Actions to create and approve pull requests* in the repo's Settings → Actions → General.

### Backups

| To… | Use |
| --- | --- |
| Undo a mistake (deleted channel, bad change) | **D1 Time Travel**, which is automatic: 7 days back on the free plan, 30 on the Workers Paid plan. `npx wrangler d1 time-travel info DB --timestamp=2026-09-01T12:00:00Z` shows the restore point; `npx wrangler d1 time-travel restore DB --timestamp=…` rewinds the database in place. It prints a bookmark that undoes the restore. |
| Keep a copy outside Cloudflare | `npm run backup` saves the database to `backups/<time>.sql`. It holds password hashes and the server's auth secret, so store it privately. |
| Rebuild from a backup | Create an empty database (`npx wrangler d1 create chat-restored`), put its id in `wrangler.jsonc` as `database_id`, run `npm run restore -- backups/<file>.sql`, then `npm run deploy`. |

Uploaded files live in R2 and are not in these backups. To copy the bucket elsewhere, use an S3-compatible tool such as `rclone` with an R2 API token.

## Deployment notes

- **Configuration.** Everything is optional. `APP_URL` is blank by default, so auth and invite links use the origin each request arrives on. Set it only to pin one origin. `BETTER_AUTH_SECRET` is generated on first run and stored in the `instance_settings` D1 table, unless you set it as a secret. Changing it signs everyone out.
- **Database id.** `database_id` in `wrangler.jsonc` is empty on purpose. The deploy button fills it in on the deployer's clone, and `npm run setup` writes it locally. Leave that change uncommitted: a committed id would point every deploy at one database, and an empty one makes `wrangler deploy` create a new database in whichever account you are logged into.
- **Build pipeline.** `npm run deploy` (which Workers Builds runs too) is `vite build`, then `wrangler d1 migrations apply DB --remote`, then `wrangler deploy`. The migration uses the `DB` binding name, so it still works if the database was renamed.
- **Turnstile.** The committed site key and the `.dev.vars.example` secret are Cloudflare's always-pass test pair. With no secret, the check is skipped. `npm run setup` creates a real widget for your `workers.dev` hostname and any `--app-url`.

## Architecture notes

- **Permissions** are resolved in one place (`shared/permissions.ts` + `worker/permissions/resolve.ts`): owner ⇒ everything; roles are OR-ed; `ADMINISTRATOR` bypasses channel overwrites; overwrites apply @everyone → roles (deny then allow) → member. Every API handler and every socket event goes through it; the browser uses the same pure functions only to hide UI.
- **Message write path**: the client sends `message.create` with a `clientMessageId` over the workspace socket. The `WorkspaceHub` re-validates membership and permissions, allocates the next `channel_sequence` from a per-channel counter (Durable Object storage, reconciled with D1 on cold start so it never moves backwards), persists to D1 in one batch, broadcasts `message.created` to channel subscribers, `channel.activity` to everyone else, and acks the originating socket. A unique index on `(channel_id, author_user_id, client_message_id)` makes retries idempotent. REST `POST /messages` delegates to the same Durable Object method.
- **Reconnect**: the client tracks the highest sequence per channel; on `channel.subscribe { sinceSequence }` the hub replies with `channel.sync` containing the gap (and `complete: false` if it exceeded 100, in which case the client refetches).
- **Presence/typing/voice presence** live only in the hub's memory and in per-socket attachments (restored after hibernation). Nothing transient is written to D1; read state is written with a debounce.
- **Uploads**: authorise → presigned PUT to the private bucket → complete. The Worker sniffs the first bytes, stores the verified MIME type, never serves SVG/HTML inline, and every download is re-authorised against channel visibility.
- **Search** uses an FTS5 table maintained by triggers and filters by the requester's visible channel ids.
- **Voice**: each voice channel maps to a long-lived RealtimeKit meeting. `POST /voice/join` checks `CONNECT`, picks the preset from `SPEAK`, adds the participant with our user id as `custom_participant_id` and returns only the participant token. Voice state (muted, camera, sharing) is mirrored to the hub so the sidebar shows who is in each room.

## Protocol

Client → server events: `channel.subscribe`, `message.create`, `message.edit`, `message.delete`, `reaction.add`, `reaction.remove`, `typing.start`, `typing.stop`, `channel.read`, `presence.set`, `voice.state`, `ping`.

Server → client events: `ready`, `channel.sync`, `message.created`, `message.updated`, `message.deleted`, `reaction.updated`, `typing.updated`, `presence.updated`, `channel.activity`, `read.updated`, `voice.updated`, `workspace.updated`, `member.removed`, `ack`, `error`, `pong`.

Both are Zod-validated discriminated unions in `shared/events.ts`.

## Not yet done

- Drag-and-drop reordering of channels (the `PUT /reorder` endpoint and position fields exist; the UI uses up/down controls).
- Passkeys (Better Auth plugin can be added without schema changes to the app tables).
- Notification preferences (placeholder screen), link unfurling and moderation pipelines (queue job types are typed but not implemented).
