/**
 * Client side of mentions: `@username`, `@everyone`, `@here` in plain message text.
 * The server (worker/lib/mentions.ts) decides who is notified; this only renders.
 */
const MENTION = /(^|[^\w@./])@([a-z0-9_.]{2,32})/gi;
const WIDE = new Set(["everyone", "here"]);

export interface MentionContext {
  /** Usernames of workspace members, lowercase. */
  known: Set<string>;
  /** The signed-in user's username, lowercase. */
  me: string;
}

/** Does this text mention `username`, @everyone or @here (outside code)? */
export function mentionsUser(content: string, username: string): boolean {
  const text = content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const me = username.toLowerCase();
  for (const match of text.matchAll(MENTION)) {
    const name = match[2]!.toLowerCase().replace(/\.+$/, "");
    if (name === me || WIDE.has(name)) return true;
  }
  return false;
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Remark plugin: turn known @mentions in text into styled spans. Code is left alone. */
export function remarkMentions(ctx: MentionContext) {
  return () => (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value?.includes("@")) next.push(...split(child.value, ctx));
        else {
          if (child.type !== "inlineCode" && child.type !== "code" && child.type !== "link") walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}

function split(value: string, ctx: MentionContext): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(MENTION)) {
    const raw = match[2]!.replace(/\.+$/, "");
    const name = raw.toLowerCase();
    if (!WIDE.has(name) && !ctx.known.has(name)) continue;
    const start = match.index! + match[1]!.length;
    if (start > last) out.push({ type: "text", value: value.slice(last, start) });
    const mine = name === ctx.me || WIDE.has(name);
    out.push({
      type: "mention",
      data: { hName: "span", hProperties: { className: mine ? ["mention", "mention-me"] : ["mention"] } },
      children: [{ type: "text", value: `@${raw}` }],
    });
    last = start + raw.length + 1;
  }
  if (last === 0) return [{ type: "text", value }];
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}
