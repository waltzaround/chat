import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, Permission, applyChannelOverwrites, computeBasePermissions, hasPermission } from "../shared/permissions";
import { toFtsQuery } from "../worker/api/workspaces";

const everyone = { id: "everyone", permissions: DEFAULT_ROLE_PERMISSIONS, position: 0 };
const mods = { id: "mods", permissions: Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS, position: 2 };
const admins = { id: "admins", permissions: Permission.ADMINISTRATOR, position: 5 };

describe("computeBasePermissions", () => {
  it("owner has everything", () => {
    expect(computeBasePermissions({ isOwner: true, everyoneRole: everyone, memberRoles: [] })).toBe(ALL_PERMISSIONS);
  });
  it("ORs the everyone role with held roles", () => {
    const bits = computeBasePermissions({ isOwner: false, everyoneRole: everyone, memberRoles: [mods] });
    expect(hasPermission(bits, Permission.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(bits, Permission.MANAGE_MESSAGES)).toBe(true);
    expect(hasPermission(bits, Permission.MANAGE_ROLES)).toBe(false);
  });
  it("administrator expands to all permissions", () => {
    expect(computeBasePermissions({ isOwner: false, everyoneRole: everyone, memberRoles: [admins] })).toBe(ALL_PERMISSIONS);
  });
});

describe("applyChannelOverwrites", () => {
  const base = computeBasePermissions({ isOwner: false, everyoneRole: everyone, memberRoles: [mods] });

  it("everyone deny hides a channel", () => {
    const bits = applyChannelOverwrites({ base, userId: "u1", everyoneRoleId: "everyone", memberRoleIds: ["mods"], overwrites: [{ targetType: "role", targetId: "everyone", allow: 0, deny: Permission.VIEW_CHANNEL }] });
    expect(hasPermission(bits, Permission.VIEW_CHANNEL)).toBe(false);
  });
  it("role allow beats everyone deny", () => {
    const bits = applyChannelOverwrites({
      base,
      userId: "u1",
      everyoneRoleId: "everyone",
      memberRoleIds: ["mods"],
      overwrites: [
        { targetType: "role", targetId: "everyone", allow: 0, deny: Permission.VIEW_CHANNEL },
        { targetType: "role", targetId: "mods", allow: Permission.VIEW_CHANNEL, deny: 0 },
      ],
    });
    expect(hasPermission(bits, Permission.VIEW_CHANNEL)).toBe(true);
  });
  it("member overwrite beats role overwrites", () => {
    const bits = applyChannelOverwrites({
      base,
      userId: "u1",
      everyoneRoleId: "everyone",
      memberRoleIds: ["mods"],
      overwrites: [
        { targetType: "role", targetId: "mods", allow: Permission.SEND_MESSAGES, deny: 0 },
        { targetType: "user", targetId: "u1", allow: 0, deny: Permission.SEND_MESSAGES },
      ],
    });
    expect(hasPermission(bits, Permission.SEND_MESSAGES)).toBe(false);
  });
  it("roles the member does not hold are ignored", () => {
    const bits = applyChannelOverwrites({ base, userId: "u1", everyoneRoleId: "everyone", memberRoleIds: [], overwrites: [{ targetType: "role", targetId: "mods", allow: 0, deny: Permission.VIEW_CHANNEL }] });
    expect(hasPermission(bits, Permission.VIEW_CHANNEL)).toBe(true);
  });
  it("administrator bypasses overwrites", () => {
    const bits = applyChannelOverwrites({ base: ALL_PERMISSIONS, userId: "u1", everyoneRoleId: "everyone", memberRoleIds: [], overwrites: [{ targetType: "user", targetId: "u1", allow: 0, deny: Permission.VIEW_CHANNEL }] });
    expect(hasPermission(bits, Permission.VIEW_CHANNEL)).toBe(true);
  });
});

describe("toFtsQuery", () => {
  it("quotes and prefix-matches each term", () => {
    expect(toFtsQuery("deploy banner")).toBe('"deploy"* "banner"*');
  });
  it("strips FTS syntax characters", () => {
    expect(toFtsQuery('"OR" NEAR(*)')).toBe('"OR"* "NEAR()"*');
  });
  it("returns null for empty input", () => {
    expect(toFtsQuery("   ")).toBeNull();
  });
});
