/**
 * Bots. The server owner creates them and holds their tokens; workspace admins with
 * "Manage integrations" add them to workspaces, where roles decide what they can do.
 */
import { Hono } from "hono";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AvailableCommand, Bot, BotSecrets, SlashCommand, WorkspaceBot } from "@shared/types";
import { displayNameSchema, idSchema } from "@shared/schemas";
import { newId } from "@shared/id";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { newBotToken } from "../auth/bots";
import { schema, type Db } from "../db";
import type { Env } from "../env";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { notifyWorkspace } from "../lib/hub";
import { iso, isoRequired, toUserSummary } from "../lib/serialize";
import { serverOwnerId } from "../instance";
import { encryptSecret, randomToken } from "../lib/crypto";
import { Permission, requireMember, requirePermission } from "../permissions/resolve";
import { createAppUser, retireAppUser } from "../integrations/app-users";
import { memberEvent, postToBot } from "../integrations/bot-events";
import { dispatchWorkspaceEvent } from "../integrations/dispatch";
import { githubCommand } from "../integrations/github-app";

type BotRow = typeof schema.bots.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

const MAX_BOTS = 50;
const MAX_COMMANDS = 50;
const PING_TIMEOUT_MS = 5_000;
/** Built-in commands a bot may not take. */
const RESERVED_COMMANDS = new Set(["github"]);

async function commandsFor(db: Db, botIds: string[]): Promise<Map<string, SlashCommand[]>> {
  const out = new Map<string, SlashCommand[]>();
  if (botIds.length === 0) return out;
  const rows = await db.select().from(schema.botCommands).where(inArray(schema.botCommands.botUserId, botIds)).orderBy(asc(schema.botCommands.name));
  for (const r of rows) out.set(r.botUserId, [...(out.get(r.botUserId) ?? []), { name: r.name, description: r.description, usage: r.usage }]);
  return out;
}

async function toBots(db: Db, rows: { bot: BotRow; user: UserRow }[]): Promise<Bot[]> {
  const ids = rows.map((r) => r.bot.userId);
  const commands = await commandsFor(db, ids);
  const counts = ids.length
    ? await db
        .select({ userId: schema.workspaceMembers.userId, n: sql<number>`count(*)` })
        .from(schema.workspaceMembers)
        .where(and(inArray(schema.workspaceMembers.userId, ids), eq(schema.workspaceMembers.status, "active")))
        .groupBy(schema.workspaceMembers.userId)
    : [];
  const countBy = new Map(counts.map((c) => [c.userId, Number(c.n)]));
  return rows.map(({ bot, user }) => ({
    ...toUserSummary(user),
    description: bot.description,
    tokenHint: bot.tokenHint,
    eventsUrl: bot.eventsUrl,
    eventsPaused: !!bot.eventsPausedAt,
    eventsFailures: bot.eventsFailures,
    commands: commands.get(bot.userId) ?? [],
    workspaceCount: countBy.get(bot.userId) ?? 0,
    lastUsedAt: iso(bot.lastUsedAt),
    createdAt: isoRequired(bot.createdAt),
  }));
}

function liveBots(db: Db) {
  return db.select({ bot: schema.bots, user: schema.users }).from(schema.bots).innerJoin(schema.users, eq(schema.users.id, schema.bots.userId)).where(isNull(schema.users.deletedAt));
}

async function loadBot(db: Db, botUserId: string): Promise<{ bot: BotRow; user: UserRow }> {
  const row = await db
    .select({ bot: schema.bots, user: schema.users })
    .from(schema.bots)
    .innerJoin(schema.users, eq(schema.users.id, schema.bots.userId))
    .where(and(eq(schema.bots.userId, botUserId), isNull(schema.users.deletedAt)))
    .get();
  if (!row) throw ApiError.notFound("Bot");
  return row;
}

/** Workspaces a bot is in, so their hubs forget cached bot lists. */
async function refreshBotWorkspaces(env: Env, db: Db, botUserId: string): Promise<void> {
  const rows = await db.select({ workspaceId: schema.workspaceMembers.workspaceId }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, botUserId));
  await Promise.all(rows.map((r) => notifyWorkspace(env, r.workspaceId, { type: "workspace.updated", reason: "integrations" })));
}

/** Local addresses only work in development; everything else must be https. */
export function eventsUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, like https://bot.example.com/events";
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return "The events URL must use https";
  if (url.username || url.password) return "Leave the user name and password out of the URL";
  return null;
}

// ---------------------------------------------------------------------------
// Server owner: create and manage bots (/api/server/bots)
// ---------------------------------------------------------------------------

export const botOwnerRoutes = new Hono<AppEnv>();
botOwnerRoutes.use("*", requireUser);
botOwnerRoutes.use("*", async (c, next) => {
  if ((await serverOwnerId(c.env.DB)) !== c.get("user").id) throw ApiError.forbidden("Only the server owner can manage bots");
  await next();
});

const createBotSchema = z.object({ name: displayNameSchema, description: z.string().trim().max(200).optional() });
const updateBotSchema = z.object({
  name: displayNameSchema.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  /** Saving it sends a ping, which must be answered with a 2xx. Null turns events off. */
  eventsUrl: z.string().trim().max(2048).nullable().optional(),
  avatarKey: z.string().max(256).nullable().optional(),
});

botOwnerRoutes.get("/", async (c) => {
  const db = c.get("db");
  return c.json(await toBots(db, await liveBots(db).orderBy(asc(schema.users.displayName))));
});

botOwnerRoutes.post("/", async (c) => {
  const db = c.get("db");
  const input = await parseBody(c, createBotSchema);
  const existing = await liveBots(db);
  if (existing.length >= MAX_BOTS) throw ApiError.conflict(`A server can have up to ${MAX_BOTS} bots`);
  const user = await createAppUser(db, { kind: "bot", name: input.name });
  const token = await newBotToken(user.id);
  const signingSecret = randomToken(32);
  await db.insert(schema.bots).values({
    userId: user.id,
    ownerUserId: c.get("user").id,
    description: input.description || null,
    tokenHash: token.hash,
    tokenHint: token.hint,
    signingSecret: await encryptSecret(c.env, signingSecret),
    createdAt: new Date(),
  });
  const [bot] = await toBots(db, [await loadBot(db, user.id)]);
  const body: BotSecrets = { bot: bot!, token: token.token, signingSecret };
  return c.json(body, 201);
});

botOwnerRoutes.patch("/:botId", async (c) => {
  const db = c.get("db");
  const { bot } = await loadBot(db, c.req.param("botId"));
  const input = await parseBody(c, updateBotSchema);
  const userChanges: Partial<UserRow> = {};
  if (input.name) userChanges.displayName = input.name;
  if (input.avatarKey !== undefined) {
    if (input.avatarKey !== null && !input.avatarKey.startsWith(`avatars/${c.get("user").id}/`)) throw ApiError.validation(undefined, "Upload the image first");
    userChanges.avatarKey = input.avatarKey;
  }
  if (Object.keys(userChanges).length) await db.update(schema.users).set({ ...userChanges, updatedAt: new Date() }).where(eq(schema.users.id, bot.userId));

  const botChanges: Partial<BotRow> = {};
  if (input.description !== undefined) botChanges.description = input.description || null;
  if (input.eventsUrl !== undefined) {
    if (input.eventsUrl) {
      const problem = eventsUrlProblem(input.eventsUrl);
      if (problem) throw ApiError.validation(undefined, problem);
      // Prove the URL answers before sending it anything real.
      const ping = { id: newId(), type: "ping", workspaceId: null, channelId: null, createdAt: new Date().toISOString(), data: {} };
      let res: Response;
      try {
        res = await postToBot(c.env, { eventsUrl: input.eventsUrl, signingSecret: bot.signingSecret }, ping, fetch, PING_TIMEOUT_MS);
        await res.body?.cancel();
      } catch {
        throw ApiError.validation(undefined, "The events URL didn't answer. Check it's reachable from the internet.");
      }
      if (!res.ok) throw ApiError.validation(undefined, `The events URL answered ${res.status}. It must answer the ping with a 2xx status.`);
    }
    Object.assign(botChanges, { eventsUrl: input.eventsUrl || null, eventsFailures: 0, eventsPausedAt: null });
  }
  if (Object.keys(botChanges).length) await db.update(schema.bots).set(botChanges).where(eq(schema.bots.userId, bot.userId));
  if (input.eventsUrl !== undefined) await refreshBotWorkspaces(c.env, db, bot.userId);
  const [updated] = await toBots(db, [await loadBot(db, bot.userId)]);
  return c.json(updated);
});

/** A new token. The old one stops working at once. */
botOwnerRoutes.post("/:botId/token", async (c) => {
  const db = c.get("db");
  const { bot } = await loadBot(db, c.req.param("botId"));
  const token = await newBotToken(bot.userId);
  await db.update(schema.bots).set({ tokenHash: token.hash, tokenHint: token.hint }).where(eq(schema.bots.userId, bot.userId));
  const [updated] = await toBots(db, [await loadBot(db, bot.userId)]);
  const body: BotSecrets = { bot: updated!, token: token.token };
  return c.json(body);
});

/** A new signing secret. Deliveries are signed with it from now on. */
botOwnerRoutes.post("/:botId/signing-secret", async (c) => {
  const db = c.get("db");
  const { bot } = await loadBot(db, c.req.param("botId"));
  const signingSecret = randomToken(32);
  await db.update(schema.bots).set({ signingSecret: await encryptSecret(c.env, signingSecret) }).where(eq(schema.bots.userId, bot.userId));
  const [updated] = await toBots(db, [await loadBot(db, bot.userId)]);
  const body: BotSecrets = { bot: updated!, signingSecret };
  return c.json(body);
});

botOwnerRoutes.delete("/:botId", async (c) => {
  const db = c.get("db");
  const { bot } = await loadBot(db, c.req.param("botId"));
  await db.delete(schema.bots).where(eq(schema.bots.userId, bot.userId));
  const workspaceIds = await retireAppUser(db, bot.userId);
  await Promise.all(workspaceIds.map((id) => notifyWorkspace(c.env, id, { type: "workspace.updated", reason: "members" })));
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Workspace admins: add and remove bots (/api/workspaces/:workspaceId/bots)
// ---------------------------------------------------------------------------

export const workspaceBotRoutes = new Hono<AppEnv>();
workspaceBotRoutes.use("*", requireUser);

workspaceBotRoutes.get("/:workspaceId/bots", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  const rows = await liveBots(db).orderBy(asc(schema.users.displayName));
  const members = rows.length
    ? await db
        .select({ userId: schema.workspaceMembers.userId })
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.status, "active"), inArray(schema.workspaceMembers.userId, rows.map((r) => r.bot.userId))))
    : [];
  const inWorkspace = new Set(members.map((m) => m.userId));
  const commands = await commandsFor(db, rows.map((r) => r.bot.userId));
  const body: WorkspaceBot[] = rows.map(({ bot, user }) => ({ ...toUserSummary(user), description: bot.description, inWorkspace: inWorkspace.has(bot.userId), commands: commands.get(bot.userId) ?? [] }));
  return c.json(body);
});

workspaceBotRoutes.post("/:workspaceId/bots", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  if (ctx.workspace.kind === "dm") throw ApiError.forbidden("Bots can't join direct messages");
  const { botId } = await parseBody(c, z.object({ botId: idSchema }));
  const { user } = await loadBot(db, botId);
  await db
    .insert(schema.workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: user.id, joinedAt: new Date(), status: "active" })
    .onConflictDoUpdate({ target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId], set: { status: "active", joinedAt: new Date() } });
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "bot.added", targetType: "user", targetId: user.id, details: { name: user.displayName } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "members" });
  await dispatchWorkspaceEvent(c.env, db, ctx.workspaceId, memberEvent(ctx.workspaceId, "member.joined", toUserSummary(user)));
  return c.body(null, 204);
});

workspaceBotRoutes.delete("/:workspaceId/bots/:botId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_INTEGRATIONS, "Manage integrations");
  const { user } = await loadBot(db, c.req.param("botId"));
  await db.batch([
    db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, ctx.workspaceId), eq(schema.memberRoles.userId, user.id))),
    db.delete(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, user.id))),
  ]);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "bot.removed", targetType: "user", targetId: user.id, details: { name: user.displayName } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "members" });
  return c.body(null, 204);
});

/** Commands the composer offers after "/": built-ins, then each bot's. */
workspaceBotRoutes.get("/:workspaceId/commands", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  const out: AvailableCommand[] = [];
  const github = await githubCommand(c.env);
  if (github && ctx.workspace.kind !== "dm") out.push({ ...github, bot: null });
  const bots = await db
    .select({ user: schema.users })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .innerJoin(schema.bots, eq(schema.bots.userId, schema.users.id))
    .where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.status, "active"), isNull(schema.users.deletedAt)));
  const commands = await commandsFor(db, bots.map((b) => b.user.id));
  for (const { user } of bots) for (const command of commands.get(user.id) ?? []) out.push({ ...command, bot: toUserSummary(user) });
  return c.json(out);
});

// ---------------------------------------------------------------------------
// The bot itself (/api/bots/@me), with its token
// ---------------------------------------------------------------------------

export const botSelfRoutes = new Hono<AppEnv>();
botSelfRoutes.use("*", requireUser);
botSelfRoutes.use("*", async (c, next) => {
  if (c.get("user").kind !== "bot") throw ApiError.forbidden("Only bots can use this endpoint");
  await next();
});

const commandSchema = z.object({
  name: z.string().regex(/^[a-z0-9_-]{1,32}$/, "Command names use lowercase letters, numbers, - and _"),
  description: z.string().trim().min(1).max(100),
  usage: z.string().trim().max(100).nullable().optional(),
});

botSelfRoutes.get("/@me", async (c) => {
  const db = c.get("db");
  const [bot] = await toBots(db, [await loadBot(db, c.get("user").id)]);
  // The owner-only fields stay with the owner.
  return c.json({ id: bot!.id, username: bot!.username, displayName: bot!.displayName, avatarUrl: bot!.avatarUrl, description: bot!.description, commands: bot!.commands, workspaceCount: bot!.workspaceCount });
});

botSelfRoutes.get("/@me/commands", async (c) => {
  const commands = await commandsFor(c.get("db"), [c.get("user").id]);
  return c.json(commands.get(c.get("user").id) ?? []);
});

/** Replaces the bot's commands with this list. */
botSelfRoutes.put("/@me/commands", async (c) => {
  const db = c.get("db");
  const botUserId = c.get("user").id;
  const list = await parseBody(c, z.array(commandSchema).max(MAX_COMMANDS));
  const names = new Set<string>();
  for (const command of list) {
    if (RESERVED_COMMANDS.has(command.name)) throw ApiError.validation(undefined, `/${command.name} is built in`);
    if (names.has(command.name)) throw ApiError.validation(undefined, `/${command.name} is listed twice`);
    names.add(command.name);
  }
  await db.batch([
    db.delete(schema.botCommands).where(eq(schema.botCommands.botUserId, botUserId)),
    ...list.map((command) => db.insert(schema.botCommands).values({ botUserId, name: command.name, description: command.description, usage: command.usage || null })),
  ] as never);
  return c.json(list.map((command) => ({ name: command.name, description: command.description, usage: command.usage || null })));
});

