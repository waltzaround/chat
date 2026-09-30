# Cloudflare community draft

## Title

Chat: open-source community chat on Workers, Durable Objects and D1

## Post

I’m building Chat, a Discord-style community app you deploy to your own Cloudflare account.

It has text channels, DMs, threads, reactions and community roles. The web app also supports voice, video and screen sharing through RealtimeKit once you configure it.

The interesting part of the backend is a Durable Object per workspace, using hibernating WebSockets for realtime events. D1 holds messages and membership data; R2 holds files. There’s a deploy button and a CLI setup flow for creating the resources.

You can try a simplified, no-signup text-chat preview and watch a recording of the real app here:
https://chat.walt.online/?utm_source=cloudflare&utm_medium=community&utm_campaign=launch#demo

Source (AGPL-3.0): https://github.com/waltzaround/chat

Web and PWA are included. Desktop, iOS and Android clients are available as source builds; mobile voice/video is still in development. This is Cloudflare-specific, and I haven’t published real community operating costs yet.

I’d especially like feedback from people willing to try the deploy flow: where does it get confusing, and what would you need before inviting your own group?

---

Attach `chat-walkthrough.mp4`. If the channel prefers short posts, use the first two paragraphs plus the demo and source links. Share the architecture article as a follow-up when it answers a question, rather than posting the same promotion repeatedly.
