# Chat

Repository: https://github.com/waltzaround/beacon

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/waltzaround/beacon)

A Discord-style community chat application built entirely on Cloudflare: Workers, Durable Objects (WebSocket Hibernation), D1, R2, Queues, RealtimeKit, Turnstile and Workers Analytics Engine — with a Vite + React front end served from Workers Static Assets.

Workspaces contain categories, text channels, voice channels (with their own chat), members, roles with a permission bitfield, channel permission overwrites, invites, bans and an audit log. Text chat is realtime over one WebSocket per workspace; voice, video and screen sharing run on Cloudflare RealtimeKit with a fully custom media UI.

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
cp .dev.vars.example .dev.vars      # set BETTER_AUTH_SECRET at minimum
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
| `npm run setup` | Provision D1, R2, a queue, secrets, and an optional deploy with Wrangler |
| `npm run deploy` | `vite build`, apply remote D1 migrations, then `wrangler deploy` |
| `node scripts/e2e-smoke.mjs` | Browser smoke test against a running dev server (needs `npx playwright install chromium`) |

### Demo seed

`npm run db:seed` creates the **Acme Community** workspace with categories General / Projects / Voice, text channels `general`, `random`, `design`, `engineering`, voice channels Lounge, Design Room, Engineering Room, five members, ~45 messages, reactions and a permanent invite at `/invite/acmedemo`.

Demo logins (password `password123`): `walter@example.com` (owner), `sarah@example.com`, `james@example.com`, `priya@example.com`, `diego@example.com`.

The production app has no dependency on seed data.

### What works locally without Cloudflare credentials

Everything except voice/video: auth (email/password), workspaces, channels, realtime chat, presence, typing, reactions, uploads (proxied through the Worker into the local R2 emulator), search and administration all run locally through the Cloudflare Vite plugin (Miniflare). Turnstile is skipped when `TURNSTILE_SECRET_KEY` is empty and a warning is logged once.

Voice needs a RealtimeKit app (see below). Until the three RealtimeKit secrets are set, joining a voice room shows an explicit "Voice is not configured on this deployment" message rather than failing silently.

## Deploying to Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/waltzaround/beacon)

The button deploys Beacon into the Cloudflare account of whoever clicks it. Cloudflare clones this repo into their GitHub or GitLab account (the repo must be public), creates the D1 database, R2 bucket, and queue there, and binds them to the Worker. Durable Objects and the Analytics Engine dataset are created on that deploy. Nothing is created in the template author's account.

`database_id` in `wrangler.jsonc` is empty on purpose. The button fills it in on the deployer's clone. Do not commit a real database id.

On the setup screen:

- Set `BETTER_AUTH_SECRET` to the output of `openssl rand -base64 32`.
- Set `APP_URL` once you know the hostname. The committed value is `http://localhost:5173`, which is wrong for a public deploy. After the first deploy, set it to `https://<worker>.<subdomain>.workers.dev` (or your custom domain) and redeploy. Invite links and auth both use it.
- Leave the other secrets blank. Email/password chat, realtime, search, and uploads work without them. Uploads are proxied through the Worker until R2 credentials are set.

The repo's `build` and `deploy` scripts are what Workers Builds runs: `vite build`, then `wrangler d1 migrations apply DB --remote`, then `wrangler deploy`. The migration command uses the `DB` binding name so it still works if the database is renamed on the setup screen.

### From the command line

`npm run setup` provisions the same resources from a clone. It logs in with Wrangler, creates the D1 database, R2 bucket, and queue, writes the database id into `wrangler.jsonc`, sets `APP_URL`, uploads secrets, and can build and deploy.

```bash
npm run setup
```

Non-interactive (a `BETTER_AUTH_SECRET` is generated when the environment does not provide one):

```bash
npm run setup -- --yes --app-url https://chat.example.com --deploy
```

Running it again keeps resources that already exist. The database id written into `wrangler.jsonc` has to stay uncommitted. `npm run setup -- --help` lists every flag. With `--yes`, voice, OAuth, Turnstile, and direct-to-R2 uploads are configured when the matching variables are in the environment or an `--env-file`.

### Optional follow-ups

These are not required for chat.

**Voice.** Create a RealtimeKit app in the Cloudflare dashboard (Realtime → RealtimeKit), then:

```bash
CLOUDFLARE_ACCOUNT_ID=... REALTIMEKIT_APP_ID=... CLOUDFLARE_REALTIME_API_TOKEN=... npm run realtimekit:presets
```

Set those three values as secrets (`wrangler secret put NAME`, or the Worker's secret settings). Until they are set, joining a voice room shows "Voice is not configured on this deployment".

**Turnstile.** Create a widget for your domain. Put the site key in `vars.TURNSTILE_SITE_KEY` and the secret in `TURNSTILE_SECRET_KEY`. The committed site key and the `.dev.vars.example` secret are Cloudflare's always-pass test pair. With no secret, the check is skipped.

**OAuth.** Optional Google and GitHub client ids and secrets. Callback URLs are `https://YOUR-APP-DOMAIN/api/auth/callback/google` and `/api/auth/callback/github`.

**Direct-to-R2 uploads.** By default the Worker proxies uploads. To let browsers PUT straight to the bucket, create an R2 API token (Object Read & Write) for `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` and set CORS:

```bash
cat > cors.json <<'EOF'
{"rules":[{"allowed":{"origins":["https://YOUR-APP-DOMAIN"],"methods":["PUT"],"headers":["Content-Type"]},"maxAgeSeconds":3600}]}
EOF
npx wrangler r2 bucket cors set chat-uploads --file cors.json --force
```

### Updating a deployment from your machine

`npm run setup` writes this deployment's database id into `wrangler.jsonc`. Leave that change uncommitted. An empty `database_id` makes `wrangler deploy` create a new database in whichever account you are logged into.

```bash
npm run deploy
```

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
