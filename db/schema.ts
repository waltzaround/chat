import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// ---------------------------------------------------------------------------
// Users + Better Auth tables
// The `users` table doubles as Better Auth's user model (usePlural: true).
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    // Better Auth's required `name` field is mapped onto display_name.
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    avatarKey: text("avatar_key"),
    bio: text("bio"),
    /** Preferred presence: online | idle | dnd | invisible */
    status: text("status").notNull().default("online"),
    /** Set by the server owner. A suspended account cannot sign in. */
    suspendedAt: timestamp("suspended_at"),
    /** The account was deleted: its profile is scrubbed and it can no longer sign in. */
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_username_idx").on(t.username)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    iconKey: text("icon_key"),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    /** community, or dm: a direct message conversation (see dmPairs). */
    kind: text("kind").notNull().default("community"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname"),
    joinedAt: timestamp("joined_at").notNull(),
    /** active | left */
    status: text("status").notNull().default("active"),
    timeoutUntil: timestamp("timeout_until"),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colour: text("colour"),
    position: integer("position").notNull().default(0),
    permissions: integer("permissions").notNull().default(0),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("roles_workspace_idx").on(t.workspaceId)],
);

export const memberRoles = sqliteTable(
  "member_roles",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId, t.roleId] }), index("member_roles_role_idx").on(t.roleId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("categories_workspace_idx").on(t.workspaceId)],
);

export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    topic: text("topic"),
    /** text | voice */
    kind: text("kind").notNull(),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at").notNull(),
    /** Highest allocated channel_sequence; the WorkspaceHub reconciles against this. */
    lastSequence: integer("last_sequence").notNull().default(0),
    lastMessageAt: timestamp("last_message_at"),
  },
  (t) => [index("channels_workspace_idx").on(t.workspaceId)],
);

export const channelPermissionOverwrites = sqliteTable(
  "channel_permission_overwrites",
  {
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    /** role | user */
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    allowPermissions: integer("allow_permissions").notNull().default(0),
    denyPermissions: integer("deny_permissions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.targetType, t.targetId] })],
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    channelSequence: integer("channel_sequence").notNull(),
    authorUserId: text("author_user_id").notNull().references(() => users.id),
    content: text("content").notNull(),
    replyToMessageId: text("reply_to_message_id"),
    /** Client-supplied idempotency key, unique per author+channel. */
    clientMessageId: text("client_message_id"),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    pinnedAt: timestamp("pinned_at"),
    pinnedBy: text("pinned_by"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_channel_sequence_idx").on(t.channelId, t.channelSequence),
    uniqueIndex("messages_client_id_idx").on(t.channelId, t.authorUserId, t.clientMessageId),
    index("messages_workspace_idx").on(t.workspaceId),
    index("messages_author_idx").on(t.authorUserId, t.createdAt),
  ],
);

export const messageAttachments = sqliteTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    /** Null until the upload is attached to a sent message. */
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    uploaderUserId: text("uploader_user_id").notNull().references(() => users.id),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    duration: integer("duration"),
    /** pending | ready */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("message_attachments_message_idx").on(t.messageId), uniqueIndex("message_attachments_key_idx").on(t.r2Key)],
);

export const messageReactions = sqliteTable(
  "message_reactions",
  {
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

export const channelReadStates = sqliteTable(
  "channel_read_states",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    lastReadSequence: integer("last_read_sequence").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

// ---------------------------------------------------------------------------
// Invites, bans, voice, audit
// ---------------------------------------------------------------------------

export const invites = sqliteTable(
  "invites",
  {
    code: text("code").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at"),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("invites_workspace_idx").on(t.workspaceId)],
);

export const bans = sqliteTable(
  "bans",
  {
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bannedBy: text("banned_by").notNull().references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const voiceChannelMeetings = sqliteTable("voice_channel_meetings", {
  channelId: text("channel_id").primaryKey().references(() => channels.id, { onDelete: "cascade" }),
  realtimekitMeetingId: text("realtimekit_meeting_id").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const customEmojis = sqliteTable(
  "custom_emojis",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Shortcode without colons, unique per workspace: [a-z0-9_]{2,32} */
    name: text("name").notNull(),
    r2Key: text("r2_key").notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("custom_emojis_workspace_name_idx").on(t.workspaceId, t.name)],
);

/** One direct message conversation per pair of people (userA < userB). */
export const dmPairs = sqliteTable(
  "dm_pairs",
  {
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userA, t.userB] }), index("dm_pairs_user_b_idx").on(t.userB)],
);

/** blocker has blocked blocked. */
export const userBlocks = sqliteTable(
  "user_blocks",
  {
    blockerUserId: text("blocker_user_id").notNull(),
    blockedUserId: text("blocked_user_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerUserId, t.blockedUserId] }), index("user_blocks_blocked_idx").on(t.blockedUserId)],
);

/** A closed DM stays out of the list until a message past this sequence arrives. */
export const dmHidden = sqliteTable(
  "dm_hidden",
  {
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    hiddenThroughSequence: integer("hidden_through_sequence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

/** Who a message notifies. Unread mention badges count rows past the reader's read marker. */
export const messageMentions = sqliteTable(
  "message_mentions",
  {
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    channelId: text("channel_id").notNull(),
    sequence: integer("sequence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] }), index("message_mentions_user_idx").on(t.userId, t.channelId, t.sequence)],
);

/** A member flagged a message for moderators. One per reporter per message. */
export const messageReports = sqliteTable(
  "message_reports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull(),
    reporterUserId: text("reporter_user_id").notNull().references(() => users.id),
    /** spam | harassment | inappropriate | other */
    reason: text("reason").notNull(),
    note: text("note"),
    /** The message text when it was reported. */
    contentSnapshot: text("content_snapshot").notNull(),
    /** open | dismissed | removed */
    status: text("status").notNull().default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("message_reports_once_idx").on(t.messageId, t.reporterUserId), index("message_reports_queue_idx").on(t.workspaceId, t.status, t.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** JSON blob with action-specific details. */
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [index("audit_log_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: integer("reset_at").notNull(),
});

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  workspaces,
  workspaceMembers,
  roles,
  memberRoles,
  categories,
  channels,
  channelPermissionOverwrites,
  messages,
  messageAttachments,
  messageReactions,
  channelReadStates,
  invites,
  bans,
  voiceChannelMeetings,
  customEmojis,
  messageReports,
  messageMentions,
  dmPairs,
  userBlocks,
  dmHidden,
  auditLog,
  rateLimits,
};

export const now = sql`(unixepoch('subsec') * 1000)`;
