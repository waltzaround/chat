/**
 * Captures screenshots of the seeded demo workspace as the owner (walter@example.com).
 *   node scripts/demo-shots.mjs [baseUrl] [outDir]
 */
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "/tmp/demo-shots";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel("Email").fill("walter@example.com");
await page.getByLabel("Password").fill("password123");
await page.screenshot({ path: `${OUT}/login.png` });
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(/\/w\//, { timeout: 20000 });
await page.getByRole("heading", { name: "general", exact: true }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/acme-general.png` });
await page.getByRole("button", { name: /engineering/ }).click();
await page.getByRole("heading", { name: "engineering", exact: true }).waitFor();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/acme-engineering.png` });
await page.locator("article").first().hover();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/acme-hover.png` });
await page.getByRole("button", { name: /Lounge/ }).click();
await page.getByRole("heading", { name: "Voice & video setup" }).waitFor({ timeout: 10000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/acme-voice-setup.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/acme-lounge.png` });
const url = page.url();
await page.goto(url.replace(/\/c\/.*$/, "/settings/roles"));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/acme-roles.png` });
await page.goto(url.replace(/\/c\/.*$/, "/settings/members"));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/acme-members.png` });
await page.goto(`${BASE}/settings/profile`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/user-profile.png` });
await browser.close();
console.log("done");
