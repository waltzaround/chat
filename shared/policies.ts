/**
 * Default privacy policy and terms, shown until the server owner writes their own
 * (Settings → Server). Markdown. {server} and {owner} are filled in when shown.
 *
 * These describe what the software actually does, so an owner who changes nothing is
 * still accurate. They are a starting point, not legal advice.
 */

export const DEFAULT_PRIVACY = `# Privacy policy

This Chat server is run by **{owner}** at **{server}**. It is self-hosted: your data is stored in the owner's own Cloudflare account, not by the makers of the Chat software.

## What is stored

- **Your account:** email address, username, display name, a password hash (if you use one), and your profile picture and bio if you add them.
- **What you post:** messages, reactions, files and images you upload, and which messages you have read.
- **Moderation records:** reports you make or that are made about your messages, bans, and a log of moderator actions.
- **Sessions:** a record of each signed-in device (browser or app), including its IP address and browser or app name.
- **Push notifications:** if you turn them on, an identifier for your device's push service. Notifications are sent without message text; your device fetches the text from this server.

## Who can see it

- Members of a workspace see what is posted in the channels they can access.
- Direct messages are visible to you and the other person. The server owner can see reported direct messages.
- The server owner and workspace moderators can see reports, bans and the moderation log.
- The server owner has technical access to everything stored on the server.

## Other services

This server runs on Cloudflare, which processes all traffic. If voice is enabled, calls are handled by Cloudflare RealtimeKit. If email is enabled, emails are sent through Cloudflare. If you sign in with Google or GitHub, those services know you signed in here.

## Your choices

- **Download your data:** Settings → Profile → Download my data.
- **Delete your account:** Settings → Profile → Delete account, or in the mobile app from your profile. You can choose to delete your messages too.
- **Block people and report messages** from the message menu.

## Contact

Questions about your data go to the server owner, **{owner}**.
`;

export const DEFAULT_TERMS = `# Terms of use

By using this Chat server at **{server}**, run by **{owner}**, you agree to these terms.

## Be decent

- No harassment, hate speech, threats, or sharing other people's private information.
- No spam, scams or malware.
- No sexual content involving minors, and nothing illegal where you or this server are.
- Respect each workspace's own rules.

## Moderation

Workspace moderators and the server owner can remove messages, and suspend, ban or delete accounts that break these terms. You can report messages and block people from the message menu.

## Your content

You keep ownership of what you post. You let this server store and show it to the people it is meant for, so the service works.

## No warranty

This server is provided as it is, by its owner, without guarantees of availability or that data will never be lost. The makers of the Chat software do not run this server and are not responsible for it.

## Changes

The owner may update these terms. Continuing to use the server means you accept the current version.
`;

export function fillPolicy(text: string, vars: { server: string; owner: string }): string {
  return text.replaceAll("{server}", vars.server).replaceAll("{owner}", vars.owner);
}
