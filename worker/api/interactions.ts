/**
 * Slash commands and buttons.
 *
 * Running `/deploy production` or pressing a bot's button sends a signed "interaction"
 * to the bot's events URL, which must answer within three seconds with one of:
 *   { "type": "message", "content": "...", "embeds": [...], "components": [...], "ephemeral": true }
 *   { "type": "update", ... }   (buttons only: replace the message the button is on)
 *   { "type": "defer" }         (answer later, within 15 minutes)
 * Later answers go to POST /api/interactions/:id/:token/respond with the same body.
 * An ephemeral message is shown only to the person who ran the command, and isn't kept.
 */
import { Hono, type Context } from "hono";
import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { ActionRow, Embed, Message, MessageAuthor, UserSummary } from "@shared/types";
import { newId } from "@shared/id";
import { MESSAGE_MAX_LENGTH, idSchema } from "@shared/schemas";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema, type Db } from "../db";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { hubFor, notifyWorkspace } from "../lib/hub";
import { toUserSummary } from "../lib/serialize";
import { loadMessage } from "../lib/messages";
import { checkRateLimit } from "../security/ratelimit";
import { Permission, hasPermission, loadChannelAccess, requireChannelAccess } from "../permissions/resolve";
import { randomToken, sha256Hex, timingSafeEqual } from "../lib/crypto";
import { normalizeComponents, normalizeEmbeds } from "../integrations/embeds";
import { postToBot, type Fetcher } from "../integrations/bot-events";
import { getGitHubApp, githubBotUser, isGitHubBot } from "../integrations/github-app";
import { runGitHubButton, runGitHubCommand } from "../integrations/github-subscriptions";

const RESPONSE_TIMEOUT_MS = 3_000;
/** How long a bot may keep answering an interaction. */
export const INTERACTION_TTL_MS = 15 * 60_000;

type UserRow = typeof schema.users.$inferSelect;
type InteractionRow = typeof schema.interactions.$inferSelect;

export interface InteractionResult {
  /** What to show: the posted message, or one only you can see. */
  message?: Message;
  /** The bot will answer later. */
  deferred?: boolean;
}

const replySchema = z.object({
  type: z.enum(["message", "update", "defer"]).optional(),
  content: z.string().max(MESSAGE_MAX_LENGTH).optional(),
  embeds: z.array(z.unknown()).max(10).optional(),
  components: z.array(z.unknown()).max(5).optional(),
  ephemeral: z.boolean().optional(),
});
type BotReply = z.infer<typeof replySchema>;

function authorOf(user: UserRow): MessageAuthor {
  return { ...toUserSummary(user), nickname: null, roleColour: null, bot: true };
}

/** A message that exists only on the invoker's screen. */
function ephemeralMessage(input: { workspaceId: string; channelId: string; author: UserRow; content: string; embeds?: Embed[]; components?: ActionRow[]; command?: string; invoker: UserSummary }): Message {
  return {
    id: `ephemeral-${newId()}`,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    sequence: 0,
    author: authorOf(input.author),
    content: input.content,
    replyTo: null,
    attachments: [],
    reactions: [],
    editedAt: null,
    pinnedAt: null,
    threadRootId: null,
    thread: null,
    embeds: input.embeds ?? [],
    components: input.components ?? [],
    interaction: input.command ? { name: input.command, user: input.invoker } : null,
    webhookId: null,
    ephemeral: true,
    createdAt: new Date().toISOString(),
  };
}

async function sendEphemeral(env: Env, userId: string, message: Message): Promise<void> {
  try {
    await hubFor(env, message.workspaceId).sendEphemeral(userId, message);
  } catch (err) {
    console.error("ephemeral delivery failed", err);
  }
}

/** Applies a bot's answer: posts, updates the clicked message, or waits for more. */
export async function applyReply(env: Env, db: Db, interaction: InteractionRow, reply: BotReply, initial: boolean): Promise<InteractionResult> {
  const type = reply.type ?? "message";
  if (type === "defer") return { deferred: true };
  const bot = await db.query.users.findFirst({ where: eq(schema.users.id, interaction.botUserId) });
  const invoker = await db.query.users.findFirst({ where: eq(schema.users.id, interaction.userId) });
  if (!bot || !invoker) throw ApiError.notFound("Interaction");
  const embeds = await normalizeEmbeds(env, reply.embeds ?? []);
  const components = normalizeComponents(reply.components ?? []);
  const content = (reply.content ?? "").trim();

  if (type === "update") {
    if (interaction.kind !== "button" || !interaction.messageId) throw ApiError.validation(undefined, "Only a button's interaction can update its message");
    const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, interaction.messageId), isNull(schema.messages.deletedAt)) });
    if (!row || row.authorUserId !== interaction.botUserId) throw ApiError.notFound("Message");
    await db
      .update(schema.messages)
      .set({
        ...(reply.content !== undefined ? { content } : {}),
        ...(reply.embeds !== undefined ? { embeds: embeds.length ? embeds : null } : {}),
        ...(reply.components !== undefined ? { components: components.length ? components : null } : {}),
      })
      .where(eq(schema.messages.id, row.id));
    const message = (await loadMessage(db, row.id, interaction.userId))!;
    await notifyWorkspace(env, row.workspaceId, { type: "message.updated", message }, row.channelId);
    return { message };
  }

  if (!content && embeds.length === 0) throw ApiError.validation(undefined, "The reply is empty");
  const command = interaction.kind === "command" ? interaction.name : undefined;
  if (reply.ephemeral) {
    const message = ephemeralMessage({ workspaceId: interaction.workspaceId, channelId: interaction.channelId, author: bot, content, embeds, components, command, invoker: toUserSummary(invoker) });
    await sendEphemeral(env, interaction.userId, message);
    return { message };
  }
  const result = await hubFor(env, interaction.workspaceId).createMessage({
    userId: interaction.botUserId,
    channelId: interaction.channelId,
    content,
    clientMessageId: initial ? `ix:${interaction.id}` : `ix:${newId()}`,
    attachmentIds: [],
    replyTo: null,
    embeds,
    components,
    interaction: command && initial ? { name: command, userId: interaction.userId } : null,
  });
  if (!result.ok) throw new ApiError(result.status, result.code, `${bot.displayName} couldn't post here: ${result.message}`);
  return { message: result.message };
}

/** Sends an interaction to its bot and applies the answer. */
async function runInteraction(env: Env, db: Db, interaction: InteractionRow, token: string, data: Record<string, unknown>, fetcher: Fetcher = fetch): Promise<InteractionResult> {
  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.userId, interaction.botUserId) });
  const botUser = await db.query.users.findFirst({ where: eq(schema.users.id, interaction.botUserId) });
  const name = botUser?.displayName ?? "The bot";
  if (!bot?.eventsUrl) throw ApiError.validation(undefined, `${name} isn't set up to answer commands yet.`);
  const payload = { id: interaction.id, type: "interaction", token, workspaceId: interaction.workspaceId, channelId: interaction.channelId, createdAt: interaction.createdAt.toISOString(), data };
  let res: Response;
  try {
    res = await postToBot(env, { eventsUrl: bot.eventsUrl, signingSecret: bot.signingSecret }, payload, fetcher, RESPONSE_TIMEOUT_MS);
  } catch {
    throw new ApiError(504, "upstream_error", `${name} didn't answer in time.`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new ApiError(502, "upstream_error", `${name} couldn't handle that (it answered ${res.status}).`);
  }
  const text = await res.text();
  if (!text.trim()) return { deferred: true };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(502, "upstream_error", `${name} sent an answer that isn't JSON.`);
  }
  const reply = replySchema.safeParse(json);
  if (!reply.success) throw new ApiError(502, "upstream_error", `${name} sent an answer this server can't use.`);
  return applyReply(env, db, interaction, reply.data, true);
}

async function createInteraction(db: Db, input: Omit<InteractionRow, "id" | "tokenHash" | "createdAt">): Promise<{ row: InteractionRow; token: string }> {
  const token = randomToken();
  const [row] = await db
    .insert(schema.interactions)
    .values({ ...input, id: newId(), tokenHash: await sha256Hex(token), createdAt: new Date() })
    .returning();
  return { row: row!, token };
}

export async function expireInteractions(db: Db): Promise<void> {
  await db.delete(schema.interactions).where(lt(schema.interactions.createdAt, new Date(Date.now() - 4 * INTERACTION_TTL_MS)));
}

// ---------------------------------------------------------------------------
// Running commands and pressing buttons (people, signed in)
// ---------------------------------------------------------------------------

export const interactionRoutes = new Hono<AppEnv>();

const commandSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  text: z.string().max(MESSAGE_MAX_LENGTH).default(""),
  /** Which bot, when two bots have a command with the same name. */
  botId: idSchema.optional(),
});

function requireHuman(c: Context<AppEnv>): UserRow {
  const user = c.get("user");
  if (user.kind !== "human") throw ApiError.forbidden("Only people can run commands and press buttons");
  return user;
}

interactionRoutes.post("/channels/:channelId/commands", requireUser, async (c) => {
  const db = c.get("db");
  const user = requireHuman(c);
  checkRateLimit(`command:${user.id}`, 20, 10_000);
  const access = await requireChannelAccess(db, c.req.param("channelId"), user.id, Permission.SEND_MESSAGES);
  const input = await parseBody(c, commandSchema);
  const invoker = toUserSummary(user);

  if (input.name === "github" && !input.botId) {
    if (!(await getGitHubApp(c.env))) throw ApiError.notFound("Command");
    const github = await githubBotUser(c.env, db);
    const text = await runGitHubCommand(c.env, db, { workspaceId: access.channel.workspaceId, channelId: access.channel.id, user, basePermissions: access.ctx.basePermissions, text: input.text });
    const message = ephemeralMessage({ workspaceId: access.channel.workspaceId, channelId: access.channel.id, author: github, content: text, command: "github", invoker });
    await sendEphemeral(c.env, user.id, message);
    return c.json({ message } satisfies InteractionResult);
  }

  const candidates = await db
    .select({ command: schema.botCommands })
    .from(schema.botCommands)
    .innerJoin(schema.workspaceMembers, and(eq(schema.workspaceMembers.userId, schema.botCommands.botUserId), eq(schema.workspaceMembers.workspaceId, access.channel.workspaceId), eq(schema.workspaceMembers.status, "active")))
    .where(eq(schema.botCommands.name, input.name));
  const match = input.botId ? candidates.find((r) => r.command.botUserId === input.botId) : candidates[0];
  if (!match) throw ApiError.notFound("Command");
  const botAccess = await loadChannelAccess(db, access.channel.id, match.command.botUserId);
  if (!botAccess || !hasPermission(botAccess.permissions, Permission.VIEW_CHANNEL)) throw ApiError.forbidden("That bot can't see this channel");

  const { row, token } = await createInteraction(db, { botUserId: match.command.botUserId, workspaceId: access.channel.workspaceId, channelId: access.channel.id, userId: user.id, kind: "command", name: input.name, messageId: null });
  const result = await runInteraction(c.env, db, row, token, {
    kind: "command",
    command: input.name,
    text: input.text,
    user: invoker,
    member: { nickname: access.ctx.member.nickname, roleIds: access.ctx.memberRoleIds },
    channel: { id: access.channel.id, name: access.channel.name },
  });
  return c.json(result);
});

interactionRoutes.post("/channels/:channelId/messages/:messageId/buttons", requireUser, async (c) => {
  const db = c.get("db");
  const user = requireHuman(c);
  checkRateLimit(`button:${user.id}`, 20, 10_000);
  const access = await requireChannelAccess(db, c.req.param("channelId"), user.id);
  const { customId } = await parseBody(c, z.object({ customId: z.string().min(1).max(100) }));
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, c.req.param("messageId")), eq(schema.messages.channelId, access.channel.id), isNull(schema.messages.deletedAt)) });
  if (!row) throw ApiError.notFound("Message");
  const button = (row.components ?? []).flatMap((r) => r.components).find((b) => b.customId === customId);
  if (!button || button.disabled || button.style === "link") throw ApiError.validation(undefined, "That button isn't on this message");

  // Buttons on the GitHub integration's own posts act on GitHub as whoever pressed them.
  if (customId.startsWith("gh:") && (await isGitHubBot(c.env, row.authorUserId))) {
    const github = await githubBotUser(c.env, db);
    const text = await runGitHubButton(c.env, db, user.id, customId);
    const message = ephemeralMessage({ workspaceId: row.workspaceId, channelId: row.channelId, author: github, content: text, invoker: toUserSummary(user) });
    await sendEphemeral(c.env, user.id, message);
    return c.json({ message } satisfies InteractionResult);
  }

  const bot = await db.query.bots.findFirst({ where: eq(schema.bots.userId, row.authorUserId) });
  if (!bot) throw ApiError.validation(undefined, "That button isn't connected to anything");
  const { row: interaction, token } = await createInteraction(db, { botUserId: bot.userId, workspaceId: row.workspaceId, channelId: row.channelId, userId: user.id, kind: "button", name: customId, messageId: row.id });
  const message = await loadMessage(db, row.id, user.id);
  const result = await runInteraction(c.env, db, interaction, token, {
    kind: "button",
    customId,
    user: toUserSummary(user),
    member: { nickname: access.ctx.member.nickname, roleIds: access.ctx.memberRoleIds },
    channel: { id: access.channel.id, name: access.channel.name },
    message,
  });
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Answering later (bots, with the interaction's token)
// ---------------------------------------------------------------------------

interactionRoutes.post("/interactions/:id/:token/respond", async (c) => {
  const db = c.get("db");
  const row = await db.query.interactions.findFirst({ where: eq(schema.interactions.id, c.req.param("id")) });
  if (!row || !timingSafeEqual(row.tokenHash, await sha256Hex(c.req.param("token")))) throw ApiError.notFound("Interaction");
  if (Date.now() - row.createdAt.getTime() > INTERACTION_TTL_MS) throw ApiError.validation(undefined, "This interaction has expired. Bots can answer for 15 minutes.");
  checkRateLimit(`interaction:${row.id}`, 10, 60_000);
  const reply = await parseBody(c, replySchema);
  // The first public answer to a deferred command carries the "used /command" line.
  const answered = await db.query.messages.findFirst({
    columns: { id: true },
    where: and(eq(schema.messages.channelId, row.channelId), eq(schema.messages.authorUserId, row.botUserId), eq(schema.messages.clientMessageId, `ix:${row.id}`)),
  });
  return c.json(await applyReply(c.env, db, row, reply, !answered));
});
