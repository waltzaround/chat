import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { ApiError } from "./errors";
import { notifyWorkspace } from "./hub";
import { serverOwnerId } from "../instance";
import { fileUrl, iso, isoRequired } from "./serialize";

/**
 * Deletes an account. The row is anonymised rather than removed so the person's
 * messages keep a valid author ("Deleted user"); everything that identifies them or
 * lets them sign in goes. With `deleteMessages`, their messages are deleted too, in
 * the background.
 */
export async function deleteAccount(env: Env, db: Db, userId: string, opts: { deleteMessages: boolean }): Promise<void> {
  if ((await serverOwnerId(env.DB)) === userId) throw ApiError.conflict("The server owner's account can't be deleted.");
  const owned = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.ownerUserId, userId));
  if (owned.length) {
    throw ApiError.conflict(`Transfer or delete the workspaces this account owns first: ${owned.map((w) => w.name).join(", ")}.`);
  }
  const memberships = await db.select({ workspaceId: schema.workspaceMembers.workspaceId }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));

  const now = new Date();
  const tag = userId.replace(/-/g, "").slice(-12);
  await db.batch([
    db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)),
    db.delete(schema.accounts).where(eq(schema.accounts.userId, userId)),
    db.delete(schema.memberRoles).where(eq(schema.memberRoles.userId, userId)),
    db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId)),
    db.delete(schema.channelReadStates).where(eq(schema.channelReadStates.userId, userId)),
    db.delete(schema.messageReactions).where(eq(schema.messageReactions.userId, userId)),
    db.update(schema.invites).set({ revokedAt: now }).where(and(eq(schema.invites.createdBy, userId), isNull(schema.invites.revokedAt))),
    db
      .update(schema.users)
      .set({
        username: `deleted_${tag}`,
        displayName: "Deleted user",
        email: `${userId}@deleted.invalid`,
        emailVerified: false,
        image: null,
        avatarKey: null,
        bio: null,
        status: "invisible",
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.users.id, userId)),
  ]);

  // Leaving each workspace also closes the person's open connections there.
  await Promise.all(memberships.map((m) => notifyWorkspace(env, m.workspaceId, { type: "member.removed", userId, reason: "left" })));
  await deletePrefix(env, `avatars/${userId}/`);
  if (opts.deleteMessages) await env.BACKGROUND_QUEUE.send({ type: "user.messages.delete", userId });
}

/** Queue job: delete one batch of a deleted account's messages, then requeue until none are left. */
export async function deleteUserMessagesBatch(env: Env, db: Db, userId: string): Promise<void> {
  const batch = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.authorUserId, userId), isNull(schema.messages.deletedAt)))
    .limit(100);
  if (batch.length === 0) return;
  const ids = batch.map((m) => m.id);
  const attachments = await db.select({ key: schema.messageAttachments.r2Key }).from(schema.messageAttachments).where(inArray(schema.messageAttachments.messageId, ids));
  await db.update(schema.messages).set({ deletedAt: new Date(), content: "" }).where(inArray(schema.messages.id, ids));
  if (attachments.length) await env.UPLOADS.delete(attachments.map((a) => a.key));
  if (batch.length === 100) await env.BACKGROUND_QUEUE.send({ type: "user.messages.delete", userId });
}

async function deletePrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.UPLOADS.list({ prefix, cursor, limit: 500 });
    if (listed.objects.length) await env.UPLOADS.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

type Cursor = { createdAt: Date; id: string };

/** One page of an account's messages, oldest first, after `cursor`. */
function authoredPage(db: Db, userId: string, cursor: Cursor | null) {
  return db
    .select({ message: schema.messages, channel: schema.channels.name, workspace: schema.workspaces.name })
    .from(schema.messages)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.messages.channelId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.messages.workspaceId))
    .where(
      and(
        eq(schema.messages.authorUserId, userId),
        isNull(schema.messages.deletedAt),
        cursor ? or(gt(schema.messages.createdAt, cursor.createdAt), and(eq(schema.messages.createdAt, cursor.createdAt), gt(schema.messages.id, cursor.id))) : undefined,
      ),
    )
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .limit(500);
}

/**
 * Everything the server holds about one account, as a JSON document streamed in pages
 * so large histories do not have to fit in memory.
 */
export function exportAccount(db: Db, userId: string): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (text: string) => writer.write(encoder.encode(text));

  void (async () => {
    try {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
      if (!user) throw new Error("User not found");
      const signIns = await db.select({ provider: schema.accounts.providerId, createdAt: schema.accounts.createdAt }).from(schema.accounts).where(eq(schema.accounts.userId, userId));
      const memberships = await db
        .select({ member: schema.workspaceMembers, workspace: { id: schema.workspaces.id, name: schema.workspaces.name } })
        .from(schema.workspaceMembers)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
        .where(eq(schema.workspaceMembers.userId, userId));

      await write(
        `{"exportedAt":${JSON.stringify(new Date().toISOString())},"profile":${JSON.stringify({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          bio: user.bio,
          avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null,
          createdAt: isoRequired(user.createdAt),
        })},"signInMethods":${JSON.stringify(signIns.map((s) => ({ provider: s.provider, since: isoRequired(s.createdAt) })))},"workspaces":${JSON.stringify(
          memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, nickname: m.member.nickname, joinedAt: isoRequired(m.member.joinedAt) })),
        )},"messages":[`,
      );

      // Keyset pagination over (createdAt, id) using the author index.
      let after: Cursor | null = null;
      let first = true;
      for (;;) {
        const page = await authoredPage(db, userId, after);
        if (page.length === 0) break;
        const files = await db
          .select({ messageId: schema.messageAttachments.messageId, filename: schema.messageAttachments.filename, key: schema.messageAttachments.r2Key })
          .from(schema.messageAttachments)
          .where(inArray(schema.messageAttachments.messageId, page.map((p) => p.message.id)));
        const filesBy = new Map<string, Array<{ filename: string; url: string }>>();
        for (const f of files) {
          const list = filesBy.get(f.messageId!) ?? [];
          list.push({ filename: f.filename, url: fileUrl(f.key) ?? "" });
          filesBy.set(f.messageId!, list);
        }
        const chunk = page
          .map((p) =>
            JSON.stringify({
              id: p.message.id,
              workspace: p.workspace,
              channel: p.channel,
              content: p.message.content,
              createdAt: isoRequired(p.message.createdAt),
              editedAt: iso(p.message.editedAt),
              attachments: filesBy.get(p.message.id) ?? [],
            }),
          )
          .join(",");
        await write(`${first ? "" : ","}${chunk}`);
        first = false;
        const last = page[page.length - 1]!.message;
        after = { createdAt: last.createdAt, id: last.id };
      }

      const reactions = await db.select({ messageId: schema.messageReactions.messageId, emoji: schema.messageReactions.emoji }).from(schema.messageReactions).where(eq(schema.messageReactions.userId, userId));
      await write(`],"reactions":${JSON.stringify(reactions)}}`);
      await writer.close();
    } catch (err) {
      await writer.abort(err);
    }
  })();
  return readable;
}
