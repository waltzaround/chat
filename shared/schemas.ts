import { z } from "zod";

export const MESSAGE_MAX_LENGTH = 2000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const idSchema = z.string().min(1).max(64);

export const usernameSchema = z
  .string()
  .trim()
  .min(2, "Username must be at least 2 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(/^[a-z0-9_.]+$/, "Use lowercase letters, numbers, dots and underscores");

export const displayNameSchema = z.string().trim().min(1).max(48);

export const channelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((s) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, ""))
  .refine((s) => s.length > 0, "Channel name is required");

export const messageContentSchema = z.string().max(MESSAGE_MAX_LENGTH);

/** A unicode emoji or a custom shortcode in the form :name: */
export const emojiSchema = z.string().min(1).max(64);

export const emojiNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{2,32}$/, "Use 2-32 lowercase letters, numbers or underscores");

export const createEmojiSchema = z.object({
  name: emojiNameSchema,
  /** R2 key returned by the upload flow (purpose "emoji"). */
  key: z.string().min(1).max(200),
});

export const colourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();

export const updateMeSchema = z.object({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(190).nullable().optional(),
  status: z.enum(["online", "idle", "dnd", "invisible"]).optional(),
  avatarKey: z.string().max(200).nullable().optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(64),
  iconKey: z.string().max(200).nullable().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  iconKey: z.string().max(200).nullable().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(48),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  position: z.number().int().min(0).optional(),
});

export const createChannelSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(["text", "voice"]),
  categoryId: idSchema.nullable().optional(),
  topic: z.string().trim().max(256).nullable().optional(),
});

export const updateChannelSchema = z.object({
  name: channelNameSchema.optional(),
  topic: z.string().trim().max(256).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderSchema = z.object({
  categories: z.array(z.object({ id: idSchema, position: z.number().int().min(0) })).optional(),
  channels: z
    .array(z.object({ id: idSchema, position: z.number().int().min(0), categoryId: idSchema.nullable() }))
    .optional(),
});

export const overwriteSchema = z.object({
  targetType: z.enum(["role", "user"]),
  targetId: idSchema,
  allow: z.number().int().min(0),
  deny: z.number().int().min(0),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(48),
  colour: colourSchema.optional(),
  permissions: z.number().int().min(0).optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(48).optional(),
  colour: colourSchema.optional(),
  permissions: z.number().int().min(0).optional(),
  position: z.number().int().min(0).optional(),
});

export const setMemberRolesSchema = z.object({
  roleIds: z.array(idSchema).max(50),
});

export const updateMemberSchema = z.object({
  nickname: z.string().trim().max(32).nullable().optional(),
  timeoutUntil: z.string().datetime().nullable().optional(),
});

export const banSchema = z.object({
  reason: z.string().trim().max(256).nullable().optional(),
  deleteRecentMessages: z.boolean().optional(),
});

export const deleteAccountSchema = z.object({
  /** Typed by the person as confirmation. */
  confirmUsername: z.string().trim().min(1),
  /** Required when the account has a password. */
  password: z.string().max(128).optional(),
  deleteMessages: z.boolean().default(false),
});

export const deleteServerUserSchema = z.object({
  deleteMessages: z.boolean().default(false),
});

export const transferOwnershipSchema = z.object({
  userId: z.string().min(1),
});

export const reportMessageSchema = z.object({
  reason: z.enum(["spam", "harassment", "inappropriate", "other"]),
  note: z.string().trim().max(500).optional(),
});

export const resolveReportSchema = z.object({
  /** "remove" deletes the message; "dismiss" keeps it. Both close every open report on it. */
  action: z.enum(["remove", "dismiss"]),
});

export const updateServerSettingsSchema = z
  .object({
    registration: z.enum(["open", "invite"]).optional(),
    workspaceCreation: z.enum(["everyone", "owner"]).optional(),
  })
  .refine((v) => v.registration !== undefined || v.workspaceCreation !== undefined, "Nothing to update");

export const createInviteSchema = z.object({
  /** Seconds until expiry, or null for never. */
  expiresIn: z.number().int().min(60).max(60 * 60 * 24 * 30).nullable().optional(),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
});

export const createMessageSchema = z.object({
  content: messageContentSchema,
  clientMessageId: z.string().min(1).max(64),
  attachmentIds: z.array(idSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  replyTo: idSchema.optional(),
});

export const editMessageSchema = z.object({
  content: messageContentSchema.min(1),
});

export const readSchema = z.object({
  sequence: z.number().int().min(0),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  channelId: idSchema.optional(),
  authorId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const messagesQuerySchema = z.object({
  before: z.coerce.number().int().min(1).optional(),
  after: z.coerce.number().int().min(0).optional(),
  around: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const uploadAuthorizeSchema = z.object({
  channelId: idSchema,
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  purpose: z.enum(["attachment", "avatar", "workspace-icon", "emoji"]).default("attachment"),
  /** Required for purpose "emoji". */
  workspaceId: idSchema.optional(),
});

export const uploadCompleteSchema = z.object({
  /** Attachment row id, or the R2 key for avatar / icon / emoji uploads. */
  attachmentId: z.string().min(1).max(200),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  duration: z.number().min(0).max(24 * 3600 * 1000).optional(),
});

export const turnstileSchema = z.object({
  turnstileToken: z.string().min(1).max(4096).optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type ReportMessageInput = z.infer<typeof reportMessageSchema>;
export type UpdateServerSettingsInput = z.infer<typeof updateServerSettingsSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type UploadAuthorizeInput = z.infer<typeof uploadAuthorizeSchema>;
