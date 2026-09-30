# How Chat runs on Cloudflare

Chat is an open-source community chat app deployed into the community owner's Cloudflare account. The web app provides channels, direct messages, threads, reactions and roles. Voice and video use RealtimeKit when configured.

## One realtime hub per workspace

Each workspace has a `WorkspaceHub` Durable Object. It accepts WebSockets through the hibernation API and stores connection metadata in serialized socket attachments so it can recover that metadata after waking.

The hub coordinates realtime events and message sequencing. Channel broadcasts check visibility so a private channel's messages are sent only to eligible connections. A separate `UserHub` handles user-level notifications.

Relevant code: [WorkspaceHub](https://github.com/waltzaround/chat/blob/main/worker/durable-objects/workspace-hub.ts) and [UserHub](https://github.com/waltzaround/chat/blob/main/worker/durable-objects/user-hub.ts).

## Data and files

D1 stores the relational data, including messages and memberships. Search uses SQLite FTS5. Files live in R2. Without direct-upload credentials, the Worker proxies uploads; with those credentials configured, clients can upload directly using signed URLs. Queues handle background jobs.

These services are resources in the operator's account. That gives the operator control over the deployment and access to the database and files. It also ties the current backend to Cloudflare.

## Calls are a separate service

RealtimeKit carries voice, video and screen sharing. Text chat works without configuring it. Calls need the RealtimeKit credentials and presets, and media usage is billed separately. Native mobile voice/video is still in development.

## Deployment and operation

The deploy button creates a copy of the repository in the operator's account. The terminal setup flow provisions resources and prints a first-owner claim link. The repository also includes update, backup and recovery commands.

Before relying on a deployment, try signup, invitations, sending messages and restoring a backup. Hosting cost depends on the workload; a benchmark for an active community has not yet been published.

Try the [interactive text-chat preview](https://chat.walt.online/#demo), watch the recording, or [run the application](https://github.com/waltzaround/chat#run-your-own-server).
