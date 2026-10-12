/**
 * An example Chat app that runs as a Cloudflare Worker.
 *
 * - /roll [sides] rolls a die in the channel.
 * - /poll <question> posts a question with Yes and No buttons; pressing one answers
 *   privately and updates the tally on the message.
 * - A message that says "!ping" gets "pong".
 *
 * Point the app's events URL at https://<this worker>/events.
 */

export interface Env {
  CHAT_URL: string;
  BOT_TOKEN: string;
  SIGNING_SECRET: string;
}

interface User {
  id: string;
  username: string;
  displayName: string;
}

interface Message {
  id: string;
  channelId: string;
  content: string;
  author: User & { bot: boolean };
}

type Delivery =
  | { type: "ping" }
  | { type: "message.created"; channelId: string; data: { message: Message } }
  | {
      type: "interaction";
      id: string;
      token: string;
      channelId: string;
      data:
        | { kind: "command"; command: string; text: string; user: User }
        | { kind: "button"; customId: string; user: User; message: Message };
    }
  | { type: string };

/** Checks X-Chat-Signature: an HMAC of `${timestamp}.${body}` with the signing secret. */
async function verify(request: Request, secret: string): Promise<Delivery | null> {
  const body = await request.text();
  const timestamp = request.headers.get("X-Chat-Timestamp");
  const signature = request.headers.get("X-Chat-Signature") ?? "";
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const hex = signature.replace(/^sha256=/, "");
  const bytes = new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  const ok = await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${timestamp}.${body}`));
  return ok ? (JSON.parse(body) as Delivery) : null;
}

/** Calls the Chat API as the bot. */
function chat(env: Env, path: string, init: { method: string; body?: unknown }) {
  return fetch(`${env.CHAT_URL}${path}`, {
    method: init.method,
    headers: { Authorization: `Bot ${env.BOT_TOKEN}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function tally(content: string, answer: "yes" | "no"): string {
  const count = (label: string) => Number(new RegExp(`${label}: (\\d+)`).exec(content)?.[1] ?? 0);
  const yes = count("Yes") + (answer === "yes" ? 1 : 0);
  const no = count("No") + (answer === "no" ? 1 : 0);
  const question = content.split("\n")[0];
  return `${question}\nYes: ${yes} · No: ${no}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/events") return new Response("Not found", { status: 404 });
    const delivery = await verify(request, env.SIGNING_SECRET);
    if (!delivery) return new Response("Bad signature", { status: 401 });

    switch (delivery.type) {
      case "ping":
        return new Response(null, { status: 204 });

      case "message.created": {
        const { message } = (delivery as Extract<Delivery, { type: "message.created" }>).data;
        if (!message.author.bot && message.content.trim().toLowerCase() === "!ping") {
          ctx.waitUntil(chat(env, `/api/channels/${message.channelId}/messages`, { method: "POST", body: { content: "pong", replyTo: message.id } }));
        }
        return new Response(null, { status: 204 });
      }

      case "interaction": {
        const { data } = delivery as Extract<Delivery, { type: "interaction" }>;
        if (data.kind === "command" && data.command === "roll") {
          const sides = Math.min(Math.max(Number.parseInt(data.text, 10) || 20, 2), 1000);
          const roll = 1 + Math.floor(Math.random() * sides);
          return Response.json({ type: "message", content: `🎲 ${data.user.displayName} rolled **${roll}** (d${sides})` });
        }
        if (data.kind === "command" && data.command === "poll") {
          if (!data.text.trim()) return Response.json({ type: "message", ephemeral: true, content: "Ask a question, like `/poll Ship on Friday?`" });
          return Response.json({
            type: "message",
            content: `**${data.text.trim()}**\nYes: 0 · No: 0`,
            components: [
              {
                type: "row",
                components: [
                  { type: "button", style: "success", label: "Yes", customId: "poll:yes" },
                  { type: "button", style: "danger", label: "No", customId: "poll:no" },
                ],
              },
            ],
          });
        }
        if (data.kind === "button" && data.customId.startsWith("poll:")) {
          const answer = data.customId === "poll:yes" ? "yes" : "no";
          // Update the message now; a private thank-you follows through the interaction token.
          const { id, token } = delivery as Extract<Delivery, { type: "interaction" }>;
          ctx.waitUntil(
            fetch(`${env.CHAT_URL}/api/interactions/${id}/${token}/respond`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "message", ephemeral: true, content: `You voted ${answer === "yes" ? "Yes" : "No"}.` }),
            }),
          );
          return Response.json({ type: "update", content: tally(data.message.content, answer) });
        }
        return Response.json({ type: "message", ephemeral: true, content: "I don't know that one." });
      }

      default:
        return new Response(null, { status: 204 });
    }
  },
} satisfies ExportedHandler<Env>;
