/**
 * End-to-end smoke test against a running dev server (default http://localhost:5173).
 * Drives two isolated browser sessions (users A and B) through the MVP checklist:
 * register → create workspace → invite → realtime chat → typing → edit/delete →
 * reload persistence → upload → search → presence → voice entry point.
 *
 *   node scripts/e2e-smoke.mjs [baseUrl] [screenshotDir]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5173";
const SHOTS = process.argv[3] ?? "/tmp/chat-shots";
mkdirSync(SHOTS, { recursive: true });

const run = Math.random().toString(36).slice(2, 7);
const results = [];
let step = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  step += 1;
  const file = path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function register(page, username, displayName) {
  await page.goto(`${BASE}/register`);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/register"), { timeout: 20_000 });
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone", "camera"], colorScheme: "dark" });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const consoleErrors = [];
for (const [name, page] of [["A", A], ["B", B]]) {
  page.on("pageerror", (err) => consoleErrors.push(`${name}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${name}: ${msg.text()}`);
  });
}

try {
  // 1. Register + create workspace
  await register(A, `alice${run}`, "Alice Example");
  await A.getByRole("heading", { name: "Welcome to Chat" }).waitFor({ timeout: 20_000 });
  check("A registers and lands in the app", true);
  await shot(A, "welcome");
  await A.getByRole("button", { name: "Create a workspace" }).first().click();
  await A.getByLabel("Workspace name").fill(`Smoke ${run}`);
  await A.getByRole("button", { name: "Create", exact: true }).click();
  await A.waitForURL(/\/w\/[^/]+\/c\/[^/]+/, { timeout: 20_000 });
  check("Workspace created and #general opened", /\/c\//.test(A.url()));
  await A.getByRole("heading", { name: "general", exact: true }).waitFor();
  await shot(A, "workspace-general");
  const workspaceUrl = A.url();

  // 2. Invite
  await A.getByRole("button", { name: /workspace menu/i }).click();
  await A.getByRole("menuitem", { name: "Invite people" }).click();
  const inviteInput = A.getByLabel("Invite link");
  await inviteInput.waitFor();
  let inviteUrl = "";
  for (let i = 0; i < 20 && !inviteUrl; i++) {
    inviteUrl = await inviteInput.inputValue();
    if (!inviteUrl) await A.waitForTimeout(250);
  }
  check("Invite link generated", /\/invite\/[A-Za-z0-9]+$/.test(inviteUrl), inviteUrl);
  await shot(A, "invite-dialog");
  await A.keyboard.press("Escape");

  // 3. B registers and accepts invite
  await register(B, `bob${run}`, "Bob Example");
  await B.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await B.getByRole("button", { name: "Accept invite" }).click();
  await B.waitForURL(/\/w\/[^/]+/, { timeout: 20_000 });
  await B.getByRole("heading", { name: "general", exact: true }).waitFor({ timeout: 20_000 });
  check("B accepts invite and lands in #general", true);

  // 4. Presence: A sees B online
  await A.getByRole("region", { name: /members/i }).or(A.locator("aside[aria-label='Members']")).first().waitFor();
  const online = A.locator("section[aria-label^='Online']");
  await online.getByText("Bob Example").waitFor({ timeout: 10_000 });
  check("A sees B in the Online group", true);

  // 5. Typing indicator + realtime message
  const composerA = A.getByRole("textbox", { name: /Message #general/ });
  await composerA.fill("Hello from Alice");
  await B.getByText("Alice Example is typing…").waitFor({ timeout: 8_000 });
  check("B sees typing indicator", true);
  await composerA.press("Enter");
  await B.getByText("Hello from Alice").waitFor({ timeout: 8_000 });
  check("B receives A's message in realtime", true);
  const composerB = B.getByRole("textbox", { name: /Message #general/ });
  await composerB.fill("Hi Alice, **bold** and `code` and https://example.com");
  await composerB.press("Enter");
  await A.getByText("Hi Alice,").waitFor({ timeout: 8_000 });
  check("A receives B's message; markdown rendered", (await A.locator(".message-body strong", { hasText: "bold" }).count()) > 0 && (await A.locator(".message-body a[href='https://example.com']").count()) > 0);
  await shot(A, "chat-two-users");

  // 6. Reply, react, edit, delete
  const bobMsg = A.locator("article", { hasText: "Hi Alice," }).first();
  await bobMsg.hover();
  await bobMsg.getByRole("button", { name: "Reply" }).click();
  await composerA.fill("replying to you");
  await composerA.press("Enter");
  await B.locator("article", { hasText: "replying to you" }).getByText("Bob Example").first().waitFor({ timeout: 8_000 });
  check("Reply shows context on the other side", true);

  await bobMsg.hover();
  await bobMsg.getByRole("button", { name: "Add reaction" }).click();
  await A.getByRole("button", { name: "thumbsup" }).click();
  await B.locator("article", { hasText: "Hi Alice," }).getByRole("button", { name: /👍 1/ }).waitFor({ timeout: 8_000 });
  check("Reaction propagates to B", true);

  const aliceMsg = A.locator("article", { hasText: "Hello from Alice" }).first();
  await aliceMsg.hover();
  await aliceMsg.getByRole("button", { name: "Edit message" }).click();
  const editBox = A.getByRole("textbox", { name: "Edit your message" });
  await editBox.fill("Hello from Alice (fixed)");
  await editBox.press("Enter");
  await B.getByText("Hello from Alice (fixed)").waitFor({ timeout: 8_000 });
  check("Edit propagates with edited marker", (await B.locator("article", { hasText: "(fixed)" }).getByText("(edited)").count()) > 0);

  await composerA.fill("to be deleted");
  await composerA.press("Enter");
  await B.getByText("to be deleted").waitFor({ timeout: 8_000 });
  const del = A.locator("article", { hasText: "to be deleted" }).first();
  await del.hover();
  await del.getByRole("button", { name: "More actions" }).click();
  await A.getByRole("menuitem", { name: "Delete" }).click();
  await A.getByRole("button", { name: "Delete", exact: true }).click();
  await B.getByText("to be deleted").waitFor({ state: "detached", timeout: 8_000 });
  check("Delete propagates to B", true);

  // 7. Reload persistence
  await B.reload();
  await B.getByText("Hello from Alice (fixed)").waitFor({ timeout: 20_000 });
  await B.getByText("replying to you").waitFor({ timeout: 8_000 });
  check("History persists across reload", true);

  // 8. Upload an image
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwHwyZ/oMhIxMDEAAA//8DAP+vBuGyuGxOAAAAAElFTkSuQmCC", "base64");
  const pngPath = path.join(SHOTS, "tiny.png");
  writeFileSync(pngPath, png);
  await A.locator("input[type=file]").first().setInputFiles(pngPath);
  await A.locator("li", { hasText: "tiny.png" }).waitFor();
  await A.waitForFunction(() => !document.querySelector("[aria-label^='Uploading']"), null, { timeout: 15_000 });
  await composerA.fill("here is a picture");
  await composerA.press("Enter");
  await B.locator("article", { hasText: "here is a picture" }).locator("img[alt='tiny.png']").waitFor({ timeout: 15_000 });
  check("Image upload appears for B", true);
  await shot(B, "chat-with-image");

  // 9. Search
  await B.keyboard.press("Control+k");
  await B.getByRole("textbox", { name: "Search messages" }).fill("replying");
  await B.getByRole("button", { name: /replying to you/ }).waitFor({ timeout: 10_000 });
  check("Search finds message", true);
  await shot(B, "search");
  await B.keyboard.press("Escape");

  // 10. Create a channel and see it appear for B; unread indicator
  await A.getByRole("button", { name: /workspace menu/i }).click();
  await A.getByRole("menuitem", { name: "Create channel" }).click();
  await A.getByLabel("Channel name").fill("announcements");
  await A.getByRole("button", { name: "Create channel" }).click();
  await A.waitForURL(/\/c\//);
  await B.getByRole("button", { name: /^announcements$/ }).waitFor({ timeout: 10_000 });
  check("New channel appears for B in realtime", true);
  await A.getByRole("textbox", { name: /Message #announcements/ }).fill("unread test");
  await A.getByRole("textbox", { name: /Message #announcements/ }).press("Enter");
  await B.locator("button:not([aria-current='page'])", { hasText: "announcements" }).locator("[aria-label='Unread messages']").waitFor({ timeout: 10_000 });
  check("Unread indicator shows on B's sidebar", true);
  await shot(B, "unread-indicator");

  // 9b. Workspace logo from the workspace menu
  await A.getByRole("button", { name: /workspace menu/i }).click();
  await A.getByRole("menuitem", { name: "Workspace logo" }).click();
  await A.getByRole("heading", { name: "Workspace logo" }).waitFor();
  await A.getByLabel("Choose workspace logo").setInputFiles(pngPath);
  await A.getByText("Workspace logo updated").waitFor({ timeout: 15_000 });
  await A.getByRole("button", { name: "Done" }).click();
  await A.locator("nav[aria-label='Workspaces'] img").first().waitFor({ timeout: 10_000 });
  await B.locator("nav[aria-label='Workspaces'] img").first().waitFor({ timeout: 10_000 });
  check("Workspace logo uploads and shows in both rails", true);
  await shot(A, "workspace-logo");

  // 10a. Sections + drag reorder by a plain member
  await B.getByRole("button", { name: "New section" }).click();
  await B.getByLabel("Section name").fill("Projects");
  await B.getByRole("button", { name: "Create", exact: true }).click();
  await B.locator("section[aria-label='Projects']").waitFor({ timeout: 10_000 });
  await A.locator("section[aria-label='Projects']").waitFor({ timeout: 10_000 });
  check("Plain member creates a section; it appears for A in realtime", true);
  const dragSource = B.locator("[data-sortable-channel]", { has: B.getByRole("button", { name: /^announcements/ }) });
  const dropTarget = B.locator("section[aria-label='Projects']");
  const src = await dragSource.boundingBox();
  const dst = await dropTarget.boundingBox();
  await B.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await B.mouse.down();
  await B.mouse.move(src.x + src.width / 2, src.y + src.height / 2 + 12, { steps: 4 });
  await B.mouse.move(dst.x + dst.width / 2, dst.y + dst.height - 6, { steps: 12 });
  await B.waitForTimeout(150);
  await B.mouse.up();
  await B.locator("section[aria-label='Projects']").getByRole("button", { name: /^announcements/ }).waitFor({ timeout: 10_000 });
  await A.locator("section[aria-label='Projects']").getByRole("button", { name: /^announcements/ }).waitFor({ timeout: 10_000 });
  check("Drag moves a channel into the new section and syncs to A", true);
  await shot(B, "drag-reorder");

  // 10b. Custom emoji: upload in settings, autocomplete with :name:, render for B
  await A.goto(workspaceUrl.replace(/\/c\/.*$/, "/settings/emojis"));
  await A.getByRole("heading", { name: "Custom emojis" }).waitFor({ timeout: 10_000 });
  await A.locator("input[type=file]").setInputFiles(pngPath);
  await A.getByLabel("Name", { exact: true }).fill("smoke_face");
  await A.getByRole("button", { name: "Add emoji" }).click();
  await A.locator("section[aria-label='Existing emojis'] li", { hasText: ":smoke_face:" }).waitFor({ timeout: 15_000 });
  check("Custom emoji uploaded from settings", true);
  await shot(A, "settings-emojis");
  await A.goto(workspaceUrl);
  const composerA2 = A.getByRole("textbox", { name: /Message #general/ });
  await composerA2.waitFor();
  await composerA2.pressSequentially("look :smoke_f", { delay: 20 });
  await A.getByRole("listbox", { name: "Emoji suggestions" }).getByText(":smoke_face:").waitFor({ timeout: 8_000 });
  check("Autocomplete dropdown shows the custom emoji", true);
  await shot(A, "emoji-autocomplete");
  await composerA2.press("Enter");
  check("Enter inserts the shortcode", (await composerA2.inputValue()).includes(":smoke_face: "));
  await composerA2.pressSequentially("and :tada", { delay: 20 });
  await A.getByRole("listbox", { name: "Emoji suggestions" }).getByText(":tada:").waitFor({ timeout: 8_000 });
  await composerA2.press("Tab");
  await composerA2.press("Enter");
  await B.locator("article", { hasText: "look" }).locator("img.emoji[alt=':smoke_face:']").waitFor({ timeout: 10_000 });
  check("Custom emoji renders inline for B; :tada: became 🎉", (await B.locator("article", { hasText: "look" }).getByText("🎉").count()) > 0);
  await shot(B, "custom-emoji-message");

  // 11. Voice entry: setup sheet then join attempt (no RealtimeKit credentials locally)
  await A.getByRole("button", { name: /^Lounge$/ }).click();
  await A.getByRole("heading", { name: "Voice & video setup" }).waitFor({ timeout: 10_000 });
  check("Device setup sheet appears on first voice join", true);
  await shot(A, "device-setup");
  await A.getByRole("button", { name: "Done" }).click();
  await A.getByRole("dialog").waitFor({ state: "detached", timeout: 10_000 });
  const notConfigured = A.getByText(/Voice is not configured/);
  const joined = A.getByRole("region", { name: "Voice controls" });
  await Promise.race([notConfigured.waitFor({ timeout: 15_000 }), joined.waitFor({ timeout: 15_000 })]);
  check("Voice join reaches the token endpoint (configured → tray, else honest not-configured toast)", true);
  await A.locator("header h1", { hasText: "Lounge" }).waitFor();
  await shot(A, "voice-channel");

  // 12. Light mode + settings
  await A.goto(`${BASE}/settings/appearance`);
  await A.getByRole("button", { name: /^Light$/ }).click();
  await A.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  check("Light theme applies", true);
  await shot(A, "settings-light");
  await A.getByRole("button", { name: /^Dark$/ }).click();
  await A.goto(workspaceUrl.replace(/\/c\/.*$/, "/settings/roles"));
  await A.getByText("Admin").first().waitFor({ timeout: 10_000 });
  check("Workspace role settings render", true);
  await shot(A, "settings-roles");

  // 13. Mobile layout
  await A.setViewportSize({ width: 390, height: 800 });
  await A.goto(workspaceUrl);
  await A.getByRole("button", { name: "Open navigation" }).click();
  await A.getByRole("button", { name: /^general$/ }).waitFor();
  check("Mobile navigation drawer works", true);
  await shot(A, "mobile-drawer");
} catch (err) {
  check("Unexpected failure", false, String(err?.message ?? err));
  await shot(A, "failure-A").catch(() => {});
  await shot(B, "failure-B").catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${SHOTS}`);
if (consoleErrors.length) {
  console.log("\nBrowser console errors:");
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log("  " + e.slice(0, 300));
}
process.exit(failed.length ? 1 : 0);
