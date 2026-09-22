# Chat

Repository: https://github.com/waltzaround/beacon

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
| `npm run deploy` | `vite build` then `wrangler deploy` |
| `node scripts/e2e-smoke.mjs` | Browser smoke test against a running dev server (needs `npx playwright install chromium`) |

### Demo seed

`npm run db:seed` creates the **Acme Community** workspace with categories General / Projects / Voice, text channels `general`, `random`, `design`, `engineering`, voice channels Lounge, Design Room, Engineering Room, five members, ~45 messages, reactions and a permanent invite at `/invite/acmedemo`.

Demo logins (password `password123`): `walter@example.com` (owner), `sarah@example.com`, `james@example.com`, `priya@example.com`, `diego@example.com`.

The production app has no dependency on seed data.

### What works locally without Cloudflare credentials

Everything except voice/video: auth (email/password), workspaces, channels, realtime chat, presence, typing, reactions, uploads (proxied through the Worker into the local R2 emulator), search and administration all run locally through the Cloudflare Vite plugin (Miniflare). Turnstile is skipped when `TURNSTILE_SECRET_KEY` is empty and a warning is logged once.

Voice needs a RealtimeKit app (see below). Until the three RealtimeKit secrets are set, joining a voice room shows an explicit "Voice is not configured on this deployment" message rather than failing silently.

## Deploying to Cloudflare

1. **Create resources**

   ```bash
   npx wrangler d1 create chat                 # paste database_id into wrangler.jsonc
   npx wrangler r2 bucket create chat-uploads
   npx wrangler queues create chat-background
   ```

   Durable Objects and the Analytics Engine dataset are created on first deploy.

2. **R2 CORS** (browsers upload straight to the bucket with presigned URLs):

   ```bash
   cat > cors.json <<'EOF'
   [{"AllowedOrigins":["https://YOUR-APP-DOMAIN"],"AllowedMethods":["PUT"],"AllowedHeaders":["Content-Type"],"MaxAgeSeconds":3600}]
   EOF
   npx wrangler r2 bucket cors put chat-uploads --file cors.json
   ```

   Create an R2 API token (Object Read & Write on this bucket) for `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. If these secrets are absent the Worker falls back to proxying uploads itself, which is fine for small deployments.

3. **RealtimeKit**: create a RealtimeKit app in the Cloudflare dashboard (Realtime → RealtimeKit), note its App ID, and create an API token with Realtime permissions. Then create the presets:

   ```bash
   CLOUDFLARE_ACCOUNT_ID=... REALTIMEKIT_APP_ID=... CLOUDFLARE_REALTIME_API_TOKEN=... npm run realtimekit:presets
   ```

4. **Turnstile**: create a widget for your domain and put the site key in `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`.

5. **Secrets** (`wrangler secret put NAME` for each):

   ```
   BETTER_AUTH_SECRET
   GOOGLE_CLIENT_ID  GOOGLE_CLIENT_SECRET       # optional
   GITHUB_CLIENT_ID  GITHUB_CLIENT_SECRET       # optional
   TURNSTILE_SECRET_KEY
   CLOUDFLARE_ACCOUNT_ID  REALTIMEKIT_APP_ID  CLOUDFLARE_REALTIME_API_TOKEN
   R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY
   ```

   OAuth callback URLs are `https://YOUR-APP-DOMAIN/api/auth/callback/github` and `/api/auth/callback/google`.

6. Set `vars.APP_URL` in `wrangler.jsonc` to your public origin, then:

   ```bash
   npm run db:migrate:remote
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
