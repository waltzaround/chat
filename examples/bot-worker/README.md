# Example Chat app

A small app for [Chat](../../docs/integrations.md) that runs as a Cloudflare Worker. It
answers `/roll`, runs yes-or-no polls with buttons, and replies "pong" to "!ping".

1. In Chat, open **Settings → Server → Apps** and create an app. Keep its token and
   signing secret.
2. Set your server's address in `wrangler.jsonc` (`CHAT_URL`), then deploy:
   ```bash
   npm install
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put SIGNING_SECRET
   npm run deploy
   ```
3. Back in Chat, edit the app and set its events URL to `https://<your worker>/events`.
   Saving checks the URL with a signed ping.
4. Register the commands:
   ```bash
   CHAT_URL=https://chat.example.com BOT_TOKEN=... npm run register
   ```
5. In a workspace's **Settings → Integrations**, add the app. Type `/roll` in a channel.

The poll counts votes in the message text, which keeps the example stateless. A real
poll would keep one vote per person, for example in a Durable Object.
