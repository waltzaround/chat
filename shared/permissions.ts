/**
 * Permission bitfield shared by the Worker and the browser.
 *
 * 17 flags fit comfortably in a JS number (< 2^53), so permissions are stored
 * as plain integers in D1 and compared with bitwise operators.
 */
export const Permission = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_WORKSPACE: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_ROLES: 1 << 3,
  MANAGE_MESSAGES: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  CREATE_INVITES: 1 << 7,
  VIEW_CHANNEL: 1 << 8,
  SEND_MESSAGES: 1 << 9,
  ADD_REACTIONS: 1 << 10,
  ATTACH_FILES: 1 << 11,
  CONNECT: 1 << 12,
  SPEAK: 1 << 13,
  VIDEO: 1 << 14,
  SCREEN_SHARE: 1 << 15,
  MANAGE_EMOJIS: 1 << 16,
} as const;

export type PermissionName = keyof typeof Permission;
export type PermissionBits = number;

export const PERMISSION_NAMES = Object.keys(Permission) as PermissionName[];

export const ALL_PERMISSIONS: PermissionBits = PERMISSION_NAMES.reduce(
  (acc, name) => acc | Permission[name],
  0,
);

/** Permissions the auto-created @everyone role starts with. */
export const DEFAULT_ROLE_PERMISSIONS: PermissionBits =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.CREATE_INVITES |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.SCREEN_SHARE;

/** Permissions that only make sense on channels (used to filter the overwrite editor). */
export const CHANNEL_PERMISSIONS: PermissionBits =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.MANAGE_MESSAGES |
  Permission.MANAGE_CHANNELS |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.VIDEO |
  Permission.SCREEN_SHARE;

export const PERMISSION_LABELS: Record<PermissionName, { label: string; description: string; group: "general" | "text" | "voice" }> = {
  ADMINISTRATOR: { label: "Administrator", description: "Grants every permission and bypasses channel overrides.", group: "general" },
  MANAGE_WORKSPACE: { label: "Manage workspace", description: "Change the workspace name, icon and settings.", group: "general" },
  MANAGE_CHANNELS: { label: "Manage channels", description: "Create, edit, reorder and delete channels and categories.", group: "general" },
  MANAGE_ROLES: { label: "Manage roles", description: "Create and edit roles below their own highest role.", group: "general" },
  MANAGE_MESSAGES: { label: "Manage messages", description: "Delete other members' messages.", group: "text" },
  KICK_MEMBERS: { label: "Kick members", description: "Remove members from the workspace.", group: "general" },
  BAN_MEMBERS: { label: "Ban members", description: "Permanently remove members and block them from re-joining.", group: "general" },
  CREATE_INVITES: { label: "Create invites", description: "Generate invite links.", group: "general" },
  VIEW_CHANNEL: { label: "View channels", description: "See channels and read their history.", group: "text" },
  SEND_MESSAGES: { label: "Send messages", description: "Post messages in text channels.", group: "text" },
  ADD_REACTIONS: { label: "Add reactions", description: "React to messages with emoji.", group: "text" },
  ATTACH_FILES: { label: "Attach files", description: "Upload images and files.", group: "text" },
  CONNECT: { label: "Connect", description: "Join voice channels.", group: "voice" },
  SPEAK: { label: "Speak", description: "Transmit microphone audio in voice channels.", group: "voice" },
  VIDEO: { label: "Video", description: "Turn on the camera in voice channels.", group: "voice" },
  SCREEN_SHARE: { label: "Screen share", description: "Share a screen or window in voice channels.", group: "voice" },
  MANAGE_EMOJIS: { label: "Manage emojis", description: "Upload and remove custom emojis for the workspace.", group: "general" },
};

export function hasPermission(bits: PermissionBits, permission: PermissionBits): boolean {
  if ((bits & Permission.ADMINISTRATOR) !== 0) return true;
  return (bits & permission) === permission;
}

export function hasAny(bits: PermissionBits, permission: PermissionBits): boolean {
  if ((bits & Permission.ADMINISTRATOR) !== 0) return true;
  return (bits & permission) !== 0;
}

export function permissionNames(bits: PermissionBits): PermissionName[] {
  return PERMISSION_NAMES.filter((name) => (bits & Permission[name]) !== 0);
}

export interface RoleLike {
  id: string;
  permissions: PermissionBits;
  position: number;
}

export interface OverwriteLike {
  targetType: "role" | "user";
  targetId: string;
  allow: PermissionBits;
  deny: PermissionBits;
}

/**
 * Pure permission resolution. Both the Worker and the client use this so that
 * the UI mirrors what the server will enforce, while the server stays authoritative.
 *
 * Order of operations (Discord-compatible):
 *  1. Owner => ADMINISTRATOR.
 *  2. OR together every role the member holds (always includes @everyone).
 *  3. ADMINISTRATOR short-circuits: all permissions everywhere.
 *  4. Channel overwrites: @everyone role overwrite, then other role overwrites
 *     (all denies then all allows), then the member-specific overwrite.
 */
export function computeBasePermissions(input: {
  isOwner: boolean;
  everyoneRole: RoleLike | null;
  memberRoles: RoleLike[];
}): PermissionBits {
  if (input.isOwner) return ALL_PERMISSIONS;
  let bits = input.everyoneRole?.permissions ?? 0;
  for (const role of input.memberRoles) bits |= role.permissions;
  if ((bits & Permission.ADMINISTRATOR) !== 0) return ALL_PERMISSIONS;
  return bits;
}

export function applyChannelOverwrites(input: {
  base: PermissionBits;
  userId: string;
  everyoneRoleId: string | null;
  memberRoleIds: string[];
  overwrites: OverwriteLike[];
}): PermissionBits {
  if ((input.base & Permission.ADMINISTRATOR) !== 0) return ALL_PERMISSIONS;
  let bits = input.base;

  const everyone = input.overwrites.find(
    (o) => o.targetType === "role" && o.targetId === input.everyoneRoleId,
  );
  if (everyone) {
    bits &= ~everyone.deny;
    bits |= everyone.allow;
  }

  let allow = 0;
  let deny = 0;
  const roleSet = new Set(input.memberRoleIds);
  for (const o of input.overwrites) {
    if (o.targetType !== "role" || o.targetId === input.everyoneRoleId) continue;
    if (!roleSet.has(o.targetId)) continue;
    allow |= o.allow;
    deny |= o.deny;
  }
  bits &= ~deny;
  bits |= allow;

  const member = input.overwrites.find((o) => o.targetType === "user" && o.targetId === input.userId);
  if (member) {
    bits &= ~member.deny;
    bits |= member.allow;
  }

  return bits;
}
