import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessagePage } from "../shared/types";
import { ORIGIN, api, createWorkspace, sendMessage, signUp, textChannel } from "./helpers";
import { extractLinks, previewFor } from "../worker/integrations/link-previews";
import { proxiedImage } from "../worker/integrations/embeds";

afterEach(() => vi.restoreAllMocks());

const page = (head: string) => new Response(`<!doctype html><html><head>${head}</head><body>hello</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

describe("link previews", () => {
  it("find links outside code, skipping ones wrapped in <>", () => {
    expect(extractLinks("see https://a.example/x, and <https://b.example/y> and `https://c.example` and https://a.example/x again (https://d.example/z)")).toEqual(["https://a.example/x", "https://d.example/z"]);
  });

  it("read Open Graph tags, proxying the image", async () => {
    const fetcher = async () =>
      page(`<title>Fallback &amp; title</title><meta property="og:title" content="Chat 2.0 &amp; more"><meta property="og:description" content="What's new"><meta property="og:image" content="/cover.png"><meta property="og:site_name" content="Chat blog"><meta name="theme-color" content="#0969da">`);
    const card = await previewFor(env, "https://blog.example/post", fetcher);
    expect(card).toMatchObject({ type: "link", url: "https://blog.example/post", title: "Chat 2.0 & more", description: "What's new", color: 0x0969da, provider: { name: "Chat blog" } });
    expect(card!.thumbnail!.url).toBe(await proxiedImage(env, "https://blog.example/cover.png"));
  });

  it("fall back to the page title, show images, and skip everything else", async () => {
    expect(await previewFor(env, "https://plain.example", async () => page("<title>Just a title</title>"))).toMatchObject({ title: "Just a title", provider: { name: "plain.example" } });
    expect(await previewFor(env, "https://img.example/cat.png", async () => new Response("png", { headers: { "content-type": "image/png" } }))).toMatchObject({ image: { url: expect.stringMatching(/^\/api\/media\?/) } });
    expect(await previewFor(env, "https://files.example/a.zip", async () => new Response("zip", { headers: { "content-type": "application/zip" } }))).toBeNull();
    expect(await previewFor(env, "https://down.example", async () => new Response("no", { status: 500 }))).toBeNull();
    expect(await previewFor(env, "https://empty.example", async () => page(""))).toBeNull();
  });

  it("are added to a sent message in the background", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => page(`<meta property="og:title" content="Linked page">`));
    const s = await signUp();
    const ws = await createWorkspace(s, "Links");
    const channel = textChannel(ws);
    const sent = await sendMessage(s, channel.id, "look https://site.example/a");
    await vi.waitFor(
      async () => {
        const [m] = (await api<MessagePage>(s.cookie, `/api/channels/${channel.id}/messages`)).messages;
        expect(m!.embeds).toMatchObject([{ type: "link", title: "Linked page" }]);
      },
      { timeout: 15_000, interval: 300 },
    );
    expect(sent.embeds).toEqual([]);
  });
});

describe("image proxy", () => {
  it("serves only images this server signed", async () => {
    const url = await proxiedImage(env, "https://img.example/a.png");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith(".svg") ? new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }) : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
    );
    const ok = await SELF.fetch(`${ORIGIN}${url}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await SELF.fetch(`${ORIGIN}/api/media?u=${encodeURIComponent("https://img.example/b.png")}&s=forged`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}${await proxiedImage(env, "https://img.example/x.svg")}`)).status).toBe(502);
  });
});
