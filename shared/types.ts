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
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerUserId: string;
  memberCount: number;
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
}
