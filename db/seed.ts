/**
 * Generates db/seed.sql with a realistic demo workspace. Run via `npm run db:seed`,
 * which pipes the SQL into the local D1 database. Idempotent: every statement
 * is INSERT OR IGNORE with deterministic ids, so re-running is a no-op.
 *
 * Demo accounts (password for all: `password123`):
 *   walter@example.com  sarah@example.com  james@example.com  priya@example.com  diego@example.com
 */
import { writeFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";

const PASSWORD = "password123";
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

// Deterministic, UUID-shaped ids that sort sensibly.
const id = (prefix: string, n: number) => `0192${prefix.padEnd(4, "0").slice(0, 4)}-0000-7000-8000-${String(n).padStart(12, "0")}`;

const users = [
  { id: id("user", 1), username: "walter", name: "Walter", email: "walter@example.com", bio: "Community lead. Ask me about onboarding." },
  { id: id("user", 2), username: "sarah", name: "Sarah Chen", email: "sarah@example.com", bio: "Design systems & accessibility." },
  { id: id("user", 3), username: "james", name: "James O'Neil", email: "james@example.com", bio: "Backend. Coffee. Repeat." },
  { id: id("user", 4), username: "priya", name: "Priya Natarajan", email: "priya@example.com", bio: "Product. Roadmaps and rituals." },
  { id: id("user", 5), username: "diego", name: "Diego Alvarez", email: "diego@example.com", bio: null },
];

const ws = { id: id("wksp", 1), name: "Acme Community", slug: "acme-community-demo01", owner: users[0]!.id };
const roles = {
  everyone: { id: id("role", 1), name: "everyone", colour: null, position: 0, permissions: 0b1111_1111_1000_0000 | (1 << 7), isDefault: 1 },
  admin: { id: id("role", 2), name: "Admin", colour: "#e0a83c", position: 3, permissions: 1, isDefault: 0 },
  moderator: { id: id("role", 3), name: "Moderator", colour: "#5b8def", position: 2, permissions: (1 << 4) | (1 << 5) | (1 << 7), isDefault: 0 },
  design: { id: id("role", 4), name: "Design", colour: "#d66ba0", position: 1, permissions: 0, isDefault: 0 },
  engineering: { id: id("role", 5), name: "Engineering", colour: "#3fb27f", position: 1, permissions: 0, isDefault: 0 },
};
// everyone: VIEW_CHANNEL|SEND_MESSAGES|ADD_REACTIONS|ATTACH_FILES|CONNECT|SPEAK|VIDEO|SCREEN_SHARE|CREATE_INVITES
roles.everyone.permissions = (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15) | (1 << 7) | (1 << 17);

const memberRoles: [string, string][] = [
  [users[0]!.id, roles.admin.id],
  [users[1]!.id, roles.moderator.id],
  [users[1]!.id, roles.design.id],
  [users[2]!.id, roles.engineering.id],
  [users[3]!.id, roles.moderator.id],
  [users[4]!.id, roles.engineering.id],
];

const categories = [
  { id: id("catg", 1), name: "General", position: 0 },
  { id: id("catg", 2), name: "Projects", position: 1 },
  { id: id("catg", 3), name: "Voice", position: 2 },
];

const channels = [
  { id: id("chan", 1), category: categories[0]!.id, name: "general", topic: "Company-wide announcements and chatter", kind: "text", position: 0 },
  { id: id("chan", 2), category: categories[0]!.id, name: "random", topic: "Off-topic. Pets encouraged.", kind: "text", position: 1 },
  { id: id("chan", 3), category: categories[1]!.id, name: "design", topic: "Design reviews, Figma links, critique", kind: "text", position: 2 },
  { id: id("chan", 4), category: categories[1]!.id, name: "engineering", topic: "Deploys, incidents, RFCs", kind: "text", position: 3 },
  { id: id("chan", 5), category: categories[2]!.id, name: "Lounge", topic: null, kind: "voice", position: 4 },
  { id: id("chan", 6), category: categories[2]!.id, name: "Design Room", topic: null, kind: "voice", position: 5 },
  { id: id("chan", 7), category: categories[2]!.id, name: "Engineering Room", topic: null, kind: "voice", position: 6 },
];

type Msg = [authorIndex: number, content: string, minutesAgo: number];
const conversations: Record<string, Msg[]> = {
  general: [
    [0, "Welcome to **Acme Community**! This is the place for announcements and general chat. Grab a role in the member list if you haven't already.", 3 * 24 * 60],
    [1, "Hi everyone 👋 Excited to be here.", 3 * 24 * 60 - 5],
    [2, "o/", 3 * 24 * 60 - 4],
    [3, "Quick reminder: the all-hands is Thursday at 10am. Agenda is in #engineering and #design threads.", 2 * 24 * 60],
    [4, "Will it be recorded? I'm travelling that day.", 2 * 24 * 60 - 12],
    [3, "Yes — we'll drop the recording here afterwards.", 2 * 24 * 60 - 10],
    [0, "New joiners this week: welcome @diego! Say hi in #random.", 26 * 60],
    [4, "Thanks Walter! Happy to be aboard.", 26 * 60 - 3],
    [1, "The new onboarding doc is live. Feedback welcome:\n> https://example.com/onboarding", 20 * 60],
    [2, "Looks great. One nit: the `wrangler login` step should come before `npm run dev`.", 19 * 60],
    [1, "Good catch, fixed.", 18 * 60],
    [0, "Heads up — we're trying voice rooms for standups from tomorrow. Join **Lounge** at 9:30.", 6 * 60],
    [3, "Love it. Camera optional?", 5 * 60 + 50],
    [0, "Always optional 🙂", 5 * 60 + 48],
    [4, "Testing reactions on this one 👀", 90],
    [2, "Anyone else seeing the deploy banner twice?", 42],
    [3, "Yep, filed it. Tracking in #engineering.", 40],
    [1, "Lunch orders close in 10 minutes!", 12],
  ],
  random: [
    [2, "Cat tax for the new channel 🐈", 40 * 60],
    [1, "Where is the cat, James", 40 * 60 - 2],
    [2, "The cat is *implied*.", 40 * 60 - 1],
    [4, "Hi all! Diego here. Coffee recommendations near the office?", 25 * 60],
    [3, "Ritual on 4th street. Don't get the oat milk, it curdles.", 25 * 60 - 6],
    [1, "Strong disagree, the oat milk is fine.", 25 * 60 - 5],
    [3, "This is now a war.", 25 * 60 - 4],
    [0, "Friday playlist thread: drop one song each.", 8 * 60],
    [2, "Anything by Khruangbin.", 8 * 60 - 20],
    [4, "Yaeji — Raingurl", 8 * 60 - 15],
    [1, "~~Baby Shark~~ just kidding. Bonobo — Kerala.", 8 * 60 - 10],
  ],
  design: [
    [1, "Design review for the **composer** is at 2pm. Figma: https://example.com/figma/composer", 30 * 60],
    [3, "Can we cover the empty states too? Especially the \"no messages\" one.", 30 * 60 - 8],
    [1, "Yes — I have three variants. Will bring all of them.", 30 * 60 - 6],
    [1, "Notes from review:\n- keep the 4px radius\n- reply banner needs more contrast\n- upload progress should be inline, not a toast", 27 * 60],
    [0, "Agree on all three. Ship it.", 26 * 60],
    [1, "Dark mode contrast pass done. Text on `--sidebar` is now 4.6:1.", 4 * 60],
    [3, "🙌", 4 * 60 - 1],
  ],
  engineering: [
    [2, "RFC: move message sequence allocation into the WorkspaceHub Durable Object so there is exactly one writer per channel.", 50 * 60],
    [4, "Makes sense. How do we recover the counter after hibernation?", 50 * 60 - 20],
    [2, "Counter lives in DO storage; on a cold start we take `max(storage, MAX(channel_sequence))`. Never goes backwards.", 50 * 60 - 15],
    [0, "Approved. Please add a test for the reconnect catch-up path.", 49 * 60],
    [2, "```ts\nconst seq = await this.nextSequence(channelId, channel.lastSequence);\n```\nDone — see `test/realtime.test.ts`.", 30 * 60],
    [4, "Deploy banner duplication is a React StrictMode double-mount in dev only. Not a prod bug.", 39],
    [2, "Closing the ticket then. Thanks!", 37],
    [3, "Incident review for Tuesday's D1 latency spike is in the shared doc. TL;DR: missing index on `messages(channel_id, channel_sequence)`.", 15],
  ],
};

function esc(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

async function main() {
  const lines: string[] = ["-- Generated by db/seed.ts — do not edit by hand", "PRAGMA foreign_keys = ON;"];
  const hash = await hashPassword(PASSWORD);

  for (const u of users) {
    lines.push(
      `INSERT OR IGNORE INTO users (id, username, display_name, email, email_verified, image, avatar_key, bio, status, created_at, updated_at) VALUES (${esc(u.id)}, ${esc(u.username)}, ${esc(u.name)}, ${esc(u.email)}, 1, NULL, NULL, ${esc(u.bio)}, 'online', ${now - 30 * day}, ${now - 30 * day});`,
    );
    lines.push(
      `INSERT OR IGNORE INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at) VALUES (${esc(id("acct", users.indexOf(u) + 1))}, ${esc(u.id)}, ${esc(u.id)}, 'credential', ${esc(hash)}, ${now - 30 * day}, ${now - 30 * day});`,
    );
  }

  lines.push(`INSERT OR IGNORE INTO workspaces (id, name, slug, icon_key, owner_user_id, created_at, updated_at) VALUES (${esc(ws.id)}, ${esc(ws.name)}, ${esc(ws.slug)}, NULL, ${esc(ws.owner)}, ${now - 20 * day}, ${now - 20 * day});`);
  users.forEach((u, i) => {
    lines.push(`INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, nickname, joined_at, status, timeout_until) VALUES (${esc(ws.id)}, ${esc(u.id)}, ${i === 2 ? "'Jimbo'" : "NULL"}, ${now - (20 - i * 3) * day}, 'active', NULL);`);
  });
  for (const r of Object.values(roles)) {
    lines.push(`INSERT OR IGNORE INTO roles (id, workspace_id, name, colour, position, permissions, is_default, created_at) VALUES (${esc(r.id)}, ${esc(ws.id)}, ${esc(r.name)}, ${esc(r.colour)}, ${r.position}, ${r.permissions}, ${r.isDefault}, ${now - 20 * day});`);
  }
  for (const [userId, roleId] of memberRoles) lines.push(`INSERT OR IGNORE INTO member_roles (workspace_id, user_id, role_id) VALUES (${esc(ws.id)}, ${esc(userId)}, ${esc(roleId)});`);
  for (const c of categories) lines.push(`INSERT OR IGNORE INTO categories (id, workspace_id, name, position) VALUES (${esc(c.id)}, ${esc(ws.id)}, ${esc(c.name)}, ${c.position});`);

  let msgCounter = 0;
  for (const ch of channels) {
    const msgs = conversations[ch.name] ?? [];
    lines.push(
      `INSERT OR IGNORE INTO channels (id, workspace_id, category_id, name, topic, kind, position, created_by, created_at, last_sequence, last_message_at) VALUES (${esc(ch.id)}, ${esc(ws.id)}, ${esc(ch.category)}, ${esc(ch.name)}, ${esc(ch.topic)}, ${esc(ch.kind)}, ${ch.position}, ${esc(ws.owner)}, ${now - 20 * day}, ${msgs.length}, ${msgs.length ? now - msgs[msgs.length - 1]![2] * 60_000 : "NULL"});`,
    );
    msgs.forEach(([author, content, minutesAgo], i) => {
      msgCounter += 1;
      const createdAt = now - minutesAgo * 60_000;
      lines.push(
        `INSERT OR IGNORE INTO messages (id, workspace_id, channel_id, channel_sequence, author_user_id, content, reply_to_message_id, client_message_id, edited_at, deleted_at, created_at) VALUES (${esc(id("mesg", msgCounter))}, ${esc(ws.id)}, ${esc(ch.id)}, ${i + 1}, ${esc(users[author]!.id)}, ${esc(content)}, ${i === 5 && ch.name === "general" ? esc(id("mesg", msgCounter - 1)) : "NULL"}, ${esc(`seed-${msgCounter}`)}, NULL, NULL, ${createdAt});`,
      );
    });
  }
  // A few reactions on #general messages.
  const generalFirst = id("mesg", 1);
  const reactionTarget = id("mesg", 15);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(generalFirst)}, ${esc(users[1]!.id)}, '👋', ${now - 3 * day});`);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(generalFirst)}, ${esc(users[2]!.id)}, '👋', ${now - 3 * day});`);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(generalFirst)}, ${esc(users[3]!.id)}, '🎉', ${now - 3 * day});`);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(reactionTarget)}, ${esc(users[0]!.id)}, '👀', ${now - 80 * 60_000});`);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(reactionTarget)}, ${esc(users[1]!.id)}, '👀', ${now - 79 * 60_000});`);
  lines.push(`INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (${esc(reactionTarget)}, ${esc(users[2]!.id)}, '🔥', ${now - 78 * 60_000});`);
  // A never-expiring invite for convenience.
  lines.push(`INSERT OR IGNORE INTO invites (code, workspace_id, created_by, expires_at, max_uses, uses, revoked_at, created_at) VALUES ('acmedemo', ${esc(ws.id)}, ${esc(ws.owner)}, NULL, NULL, 0, NULL, ${now - 10 * day});`);
  // Audit entries so the log isn't empty.
  lines.push(`INSERT OR IGNORE INTO audit_log (id, workspace_id, actor_user_id, action, target_type, target_id, details, created_at) VALUES (${esc(id("audt", 1))}, ${esc(ws.id)}, ${esc(ws.owner)}, 'channel.created', 'channel', ${esc(channels[3]!.id)}, '{"name":"engineering","kind":"text"}', ${now - 19 * day});`);
  lines.push(`INSERT OR IGNORE INTO audit_log (id, workspace_id, actor_user_id, action, target_type, target_id, details, created_at) VALUES (${esc(id("audt", 2))}, ${esc(ws.id)}, ${esc(ws.owner)}, 'role.created', 'role', ${esc(roles.moderator.id)}, '{"name":"Moderator"}', ${now - 18 * day});`);
  lines.push(`INSERT OR IGNORE INTO audit_log (id, workspace_id, actor_user_id, action, target_type, target_id, details, created_at) VALUES (${esc(id("audt", 3))}, ${esc(ws.id)}, ${esc(users[1]!.id)}, 'invite.created', 'invite', 'acmedemo', '{"expiresAt":null,"maxUses":null}', ${now - 10 * day});`);

  // The demo owner owns the server too, and anyone can sign up to try it.
  lines.push(`INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('owner_user_id', ${esc(ws.owner)});`);
  lines.push(`INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('registration', 'open');`);

  writeFileSync(new URL("./seed.sql", import.meta.url), lines.join("\n") + "\n");
  console.log(`Wrote db/seed.sql (${lines.length} statements). Demo login: walter@example.com / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
