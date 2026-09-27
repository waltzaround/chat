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
  emailVerified: boolean;
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
  /** The latest message, for the preview line. Null for linked servers' rails. */
  lastMessage: { authorId: string; content: string; hasAttachments: boolean } | null;
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
  /** Seconds between messages per member; 0 is off. */
  slowmodeSeconds: number;
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
  /** Filtered words, one per line. Only sent to members who can manage the workspace. */
  wordFilter: string;
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
  /** Set while the message is pinned to its channel. */
  pinnedAt: string | null;
  /** On a thread reply: the message that started the thread. */
  threadRootId: string | null;
  /** On a message with thread replies. */
  thread: { replyCount: number; lastReplyAt: string | null } | null;
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
  /** Present in search across all workspaces: where the message is. */
  workspace?: { id: string; name: string; kind: "community" | "dm"; dmPeerName: string | null };
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
  server: ServerBranding;
  providers: { github: boolean; google: boolean };
  turnstileSiteKey: string | null;
  /** No owner yet: the next sign-up becomes the server owner. */
  firstRun: boolean;
  /** First run, and only the holder of the setup link may create the owner account. */
  claimRequired: boolean;
  registration: RegistrationPolicy;
  /** "Forgot password?" can email a reset link (needs email set up, on the Workers Paid plan). */
  passwordResetEmail: boolean;
  /** New accounts must confirm their email before signing in. */
  requireVerifiedEmail: boolean;
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

/** What a client learns about a server before signing in: GET /api/instance. */
/** Name, description and icon the server owner set. All optional. */
export interface ServerBranding {
  name: string | null;
  description: string | null;
  /** Public, relative to the server: no sign-in needed. */
  iconUrl: string | null;
}

export interface InstanceInfo {
  server: ServerBranding;
  /** Always "chat", so apps can tell they've found a server of this kind. */
  software: "chat";
  version: string;
  apiVersion: number;
  registration: RegistrationPolicy;
  /** How apps can create accounts here. */
  signUp: {
    /** Anyone can register in the app (open sign-up, and the owner account exists). */
    open: boolean;
    /** Registration needs a Turnstile token: apps get one from /app-challenge. */
    challenge: boolean;
    /** New accounts must confirm their email before they can sign in. */
    requireVerifiedEmail: boolean;
  };
  features: { voice: boolean; passwordResetEmail: boolean; googleSignIn: boolean; githubSignIn: boolean };
}

/** "invite": only people with a working invite link can create an account. */
export type RegistrationPolicy = "open" | "invite";

/** "owner": only the server owner can create workspaces. */
export type WorkspaceCreationPolicy = "everyone" | "owner";

/** The server's privacy policy and terms, as Markdown, ready to show. */
export interface ServerPolicies {
  privacyPolicy: string;
  terms: string;
  /** False while the owner hasn't written their own and the template shows. */
  customPrivacy: boolean;
  customTerms: boolean;
}

export interface ServerSettings extends ServerBranding {
  /** The owner's own text, or null for the template. */
  privacyPolicy: string | null;
  terms: string | null;
  registration: RegistrationPolicy;
  workspaceCreation: WorkspaceCreationPolicy;
  /** Email is set up, so members can reset their own password. */
  emailEnabled: boolean;
  /** New accounts must confirm their email before signing in (needs email). */
  requireVerifiedEmail: boolean;
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
