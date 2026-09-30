# Chat launch kit

Positioning: **Open-source Discord-style chat you deploy to your own Cloudflare account.**

Audience: developers who run a small community, project group or recurring meetup.

## Assets

- Website: https://chat.walt.online/ (publish the updated site before using these drafts).
- Interactive preview: https://chat.walt.online/#demo. A simplified browser-only text-chat preview; no shared server, signup, voice or uploads.
- Real app walkthrough: `apps/website/public/chat-walkthrough.mp4`, with English captions in `chat-walkthrough.vtt`.
- Source: https://github.com/waltzaround/chat. The product name remains **Chat**. The repository is currently private; public source access is a launch blocker.
- Posts: [Cloudflare](cloudflare.md), [Show HN](show-hn.md), [community trial invitation](community-trial.md).
- Technical article: [How Chat runs on Cloudflare](architecture.md).
- Costs: [measurement procedure](costs.md). No measured active-community cost is available yet.

## Publishing order

1. Resolve source access first: `waltzaround/chat` is currently private. Do not post an open-source launch while visitors cannot read or deploy the source. Changing repository visibility needs explicit approval because it exposes code and history. Review the local website, then publish using `npm run website:deploy`. Verify the preview, video, captions and deployment link on the public domain. Native and desktop clients are described as source builds; do not imply App Store or Play Store availability.
2. Share the Cloudflare draft in an appropriate project-sharing channel in the [developer community](https://www.cloudflare.com/community/). Attach the clip. Check channel rules before posting.
3. Work through deployment feedback from initial users. Record failure points and update setup instructions.
4. Submit the Show HN title and website URL at https://news.ycombinator.com/submit. Add the supplied first comment. Remain available for questions. [Show HN guidelines](https://news.ycombinator.com/showhn.html) call for something people can try and discourage vote solicitation.
5. Personally invite a handful of relevant community admins using the trial draft. Offer one project channel or one event as the initial trial.

These are drafts. Nothing has been posted to an external community.

## Record the walkthrough again

Prepare the isolated local database and start its server:

```sh
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/demo-state
npx wrangler d1 execute DB --local --persist-to .wrangler/demo-state --file=db/seed.sql
npx vite --config vite.demo.config.ts --host 127.0.0.1 --port 5176 --strictPort
```

In another terminal run `node scripts/record-launch-demo.mjs`. Requires installed Playwright Chromium and ffmpeg. Uses only a local server and fictional seeded accounts. The script sends a sample message to the local general channel. Review the clip and captions after each recording.

## First useful outcome

Aim for five communities using Chat weekly. Ask participating admins for deployment success, accepted invitations and whether members are still active after two weeks. Collect these with their agreement; do not add hidden reporting to self-hosted servers.
