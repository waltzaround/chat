/**
 * API DTOs shared by the Worker and the browser.
 * Timestamps are ISO-8601 strings on the wire.
 */
import type { PermissionBits } from "./permissions";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";
/** The user's preferred status. `invisible` appears offline to others. */
export type PreferredStatus = "online" | "idle" | "dnd" | "invisible";

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CurrentUser extends UserSummary {
  email: string;
  bio: string | null;
  status: PreferredStatus;
  createdAt: string;
  /** The account that set this server up. Only it can change server settings. */
  isServerOwner: boolean;
  /** False when the owner limits workspace creation to themselves. */
  canCreateWorkspace: boolean;
  /** Signs in with a password (not only Google/GitHub). Deleting the account asks for it. */
  hasPassword: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerUserId: string;
  memberCount: number;
  /** Unread messages that mention you, across the channels you can see. */
  mentionCount: number;
  /** "dm" for a direct message conversation. */
  kind: "community" | "dm";
}

/** A direct message conversation, as listed in the DM sidebar. */
export interface DirectMessage {
  workspaceId: string;
  channelId: string;
  /** The other person. Shown as "Deleted user" once their account is gone. */
  peer: UserSummary;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface Category {
  id: string;
  workspaceId: string;
  name: string;
  position: number;
}

export type ChannelKind = "text" | "voice";

export interface Channel {
  id: string;
  workspaceId: string;
  categoryId: string | null;
  name: string;
  topic: string | null;
  kind: ChannelKind;
  position: number;
  lastSequence: number;
  /** Resolved permissions of the requesting user in this channel. */
  permissions: PermissionBits;
  lastReadSequence: number;
  /** Unread messages here that mention you. */
  mentionCount: number;
}

export interface Role {
  id: string;
  workspaceId: string;
  name: string;
  colour: string | null;
  position: number;
  permissions: PermissionBits;
  isDefault: boolean;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  categories: Category[];
  channels: Channel[];
  roles: Role[];
  myRoleIds: string[];
  myPermissions: PermissionBits;
  myNickname: string | null;
  createdAt: string;
  /** In a direct message conversation, the other person. */
  dmPeer: UserSummary | null;
}

export interface Member extends UserSummary {
  userId: string;
  nickname: string | null;
  bio: string | null;
  roleIds: string[];
  joinedAt: string;
  timeoutUntil: string | null;
  isOwner: boolean;
}

export interface CustomEmoji {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  createdBy: string | null;
  createdAt: string;
}

export interface PermissionOverwrite {
  channelId: string;
  targetType: "role" | "user";
  targetId: string;
  allow: PermissionBits;
  deny: PermissionBits;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  url: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  me: boolean;
  userIds: string[];
}

export interface MessageAuthor extends UserSummary {
  nickname: string | null;
  roleColour: string | null;
}

export interface ReplyContext {
  id: string;
  author: UserSummary | null;
  content: string;
  deleted: boolean;
}

export interface Message {
  id: string;
  workspaceId: string;
  channelId: string;
  sequence: number;
  author: MessageAuthor;
  content: string;
  replyTo: ReplyContext | null;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  editedAt: string | null;
  createdAt: string;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

export interface Invite {
  code: string;
  workspaceId: string;
  createdBy: UserSummary | null;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revokedAt: string | null;
  createdAt: string;
  url: string;
}

export interface InvitePreview {
  code: string;
  workspace: { id: string; name: string; iconUrl: string | null; memberCount: number };
  inviter: UserSummary | null;
  expiresAt: string | null;
  isMember: boolean;
}

export interface Ban {
  userId: string;
  user: UserSummary | null;
  bannedBy: UserSummary | null;
  reason: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actor: UserSummary | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface SearchResult {
  message: Message;
  channelName: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface UploadAuthorization {
  attachmentId: string;
  /** PUT the raw file body here. */
  uploadUrl: string;
  /** Headers the browser must send with the PUT. */
  headers: Record<string, string>;
  /** "presigned" uploads go straight to R2; "proxy" goes through the Worker (dev fallback). */
  mode: "presigned" | "proxy";
  expiresAt: string;
}

export interface VoiceJoinResponse {
  authToken: string;
  meetingId: string;
  channelId: string;
  permissions: PermissionBits;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AuthConfig {
  providers: { github: boolean; google: boolean };
  turnstileSiteKey: string | null;
  /** No owner yet: the next sign-up becomes the server owner. */
  firstRun: boolean;
  /** First run, and only the holder of the setup link may create the owner account. */
  claimRequired: boolean;
  registration: RegistrationPolicy;
  /** "Forgot password?" can email a reset link (needs email set up, on the Workers Paid plan). */
  passwordResetEmail: boolean;
}

export type ReportReason = "spam" | "harassment" | "inappropriate" | "other";

/** One reported message in a workspace's moderation queue, with everyone who reported it. */
export interface ReportedMessage {
  messageId: string;
  channelId: string;
  channelName: string;
  author: UserSummary | null;
  /** Text when first reported. */
  content: string;
  /** Already deleted (by its author or a moderator). */
  messageDeleted: boolean;
  firstReportedAt: string;
  reports: Array<{ reporter: UserSummary | null; reason: ReportReason; note: string | null; createdAt: string }>;
}

/** "invite": only people with a working invite link can create an account. */
export type RegistrationPolicy = "open" | "invite";

/** "owner": only the server owner can create workspaces. */
export type WorkspaceCreationPolicy = "everyone" | "owner";

export interface ServerSettings {
  registration: RegistrationPolicy;
  workspaceCreation: WorkspaceCreationPolicy;
  /** Email is set up, so members can reset their own password. */
  emailEnabled: boolean;
}

/** An account as the server owner sees it in User Settings → Server. */
export interface ServerUser extends UserSummary {
  email: string;
  createdAt: string;
  isServerOwner: boolean;
  suspended: boolean;
}

/** A one-time link that lets the holder set a new password for one account. */
export interface PasswordResetLink {
  url: string;
  expiresAt: string;
}
