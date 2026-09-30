# Show HN draft

## Title

Show HN: Chat – Open-source Discord-style chat on your Cloudflare account

## URL

https://chat.walt.online/?utm_source=hackernews&utm_medium=community&utm_campaign=launch

## First comment

Hi HN, I’m the developer of Chat, a community chat app you can deploy to your own Cloudflare account.

It has channels, DMs, threads, reactions, search, roles and channel permissions. Voice, video and screen sharing use RealtimeKit and require separate setup. There’s a deploy button and a CLI that provisions the Cloudflare resources.

The site has a no-signup interactive preview of text chat and a short recording of the real web app. The preview is a simplified browser-only sandbox; to try the full application, deploy it or run the repository locally.

Underneath it’s Workers, one Durable Object per workspace with hibernating WebSockets, D1 and R2. The source is AGPL-3.0:
https://github.com/waltzaround/chat

A few limitations up front: it currently depends on Cloudflare, the desktop and native clients are source builds, mobile voice/video is unfinished, and I don’t yet have measured running costs for an active community. The web app can also be installed as a PWA.

I’m interested in hearing from people who run small communities: what would make this useful enough to try with one project or meetup? Deployment feedback is especially welcome.

## Replies to likely questions

**Can I host it on my own VPS?**
Not currently. The backend uses Cloudflare-specific services. You control the Cloudflare account and resources, but it is not portable to a generic VPS as it stands.

**Is it end-to-end encrypted?**
Do not claim E2EE. The server handles message content; owning the deployment is a different property from end-to-end encryption.

**Is hosting free?**
Text chat can fit within free allowances, but that is not a guarantee for a given community. Usage, storage and media determine the bill. We have not published a measured community cost yet.

**Can I download the mobile apps?**
The source and build instructions are in the repository. Do not claim public store listings or downloadable release builds without checking them.
