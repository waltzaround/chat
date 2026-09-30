import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:5175";
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/#demo`);
    await page.getByRole("heading", { name: "Take a look. Make yourself at home." }).waitFor();
    const demo = page.locator("#demo");
    await demo.getByLabel("Message in preview").fill("A message from a visitor");
    await demo.getByRole("button", { name: "Send", exact: true }).click();
    await demo.getByText("A message from a visitor", { exact: true }).waitFor();
    await demo.getByRole("button", { name: "Like message from You" }).click();
    assert.equal(await demo.getByRole("button", { name: "Like message from You" }).getAttribute("aria-pressed"), "true");
    await demo.getByRole("button", { name: "# projects", exact: true }).click();
    assert.equal(await demo.getByText("A message from a visitor", { exact: true }).count(), 0);
    await demo.getByRole("button", { name: "# general", exact: true }).click();
    await demo.getByText("A message from a visitor", { exact: true }).waitFor();
    await demo.getByRole("button", { name: "Reset preview" }).click();
    assert.equal(await demo.getByText("A message from a visitor", { exact: true }).count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: `/tmp/chat-website-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Passed: ${width}px; send, reaction, channel isolation, reset, layout, runtime errors`);
  }
} finally { await browser.close(); }
