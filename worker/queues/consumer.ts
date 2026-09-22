import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { BackgroundJob, Env } from "../env";
import { createDb, schema } from "../db";

/**
 * Background work that must not delay the request path. Every job is
 * idempotent so retries are safe.
 */
export async function handleQueue(batch: MessageBatch<BackgroundJob>, env: Env): Promise<void> {
  const db = createDb(env.DB);
  for (const msg of batch.messages) {
    try {
      await handleJob(msg.body, env, db);
      msg.ack();
    } catch (err) {
      console.error("queue job failed", msg.body.type, err);
      msg.retry({ delaySeconds: 30 });
    }
  }
}

async function handleJob(job: BackgroundJob, env: Env, db: ReturnType<typeof createDb>): Promise<void> {
  switch (job.type) {
    case "attachment.process": {
      // Verify the object exists and record its real size/type from R2 metadata.
      const row = await db.query.messageAttachments.findFirst({ where: eq(schema.messageAttachments.id, job.attachmentId) });
      if (!row) return;
      const head = await env.UPLOADS.head(row.r2Key);
      if (!head) return;
      await db
        .update(schema.messageAttachments)
        .set({ byteSize: head.size, mimeType: head.httpMetadata?.contentType ?? row.mimeType })
        .where(eq(schema.messageAttachments.id, row.id));
      return;
    }
    case "attachment.cleanup": {
      // Remove uploads that were authorised but never attached to a message.
      const cutoff = new Date(Date.now() - job.olderThanMs);
      const orphans = await db.query.messageAttachments.findMany({
        where: and(isNull(schema.messageAttachments.messageId), lt(schema.messageAttachments.createdAt, cutoff)),
        limit: 200,
      });
      if (orphans.length === 0) return;
      await env.UPLOADS.delete(orphans.map((o) => o.r2Key));
      await db.delete(schema.messageAttachments).where(sql`${schema.messageAttachments.id} in ${orphans.map((o) => o.id)}`);
      return;
    }
    case "invites.expire": {
      await db.update(schema.invites).set({ revokedAt: new Date() }).where(and(isNull(schema.invites.revokedAt), lt(schema.invites.expiresAt, new Date())));
      return;
    }
    case "message.deleted": {
      if (job.attachmentKeys.length) await env.UPLOADS.delete(job.attachmentKeys);
      return;
    }
    case "workspace.deleted": {
      let cursor: string | undefined;
      do {
        const listed = await env.UPLOADS.list({ prefix: job.r2Prefix, cursor, limit: 500 });
        if (listed.objects.length) await env.UPLOADS.delete(listed.objects.map((o) => o.key));
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
      return;
    }
  }
}
