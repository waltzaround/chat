import type { CustomEmoji } from "@shared/types";

/**
 * Emoji shortcodes. Standard emoji get a curated table (shortcode → unicode);
 * custom emoji come from the workspace and are referenced as `:name:` in
 * message text, which the renderer turns into an inline image.
 */
export interface EmojiEntry {
  /** Shortcode without colons. */
  name: string;
  /** Unicode character for standard emoji; undefined for custom. */
  char?: string;
  /** Image URL for custom emoji. */
  url?: string;
  keywords: string[];
  group: string;
  custom?: boolean;
}

const T = (group: string, rows: [char: string, name: string, ...keywords: string[]][]): EmojiEntry[] =>
  rows.map(([char, name, ...keywords]) => ({ char, name, keywords, group }));

export const STANDARD_EMOJI: EmojiEntry[] = [
  ...T("Frequent", [
    ["👍", "thumbsup", "+1", "like", "yes"],
    ["👎", "thumbsdown", "-1", "no"],
    ["❤️", "heart", "love"],
    ["😂", "joy", "laugh", "lol"],
    ["🎉", "tada", "party", "celebrate"],
    ["👀", "eyes", "look"],
    ["🔥", "fire", "lit", "hot"],
    ["✅", "white_check_mark", "check", "done", "yes"],
    ["🙏", "pray", "thanks", "please"],
    ["😮", "open_mouth", "wow"],
    ["😢", "cry", "sad"],
    ["💯", "100", "hundred"],
    ["🚀", "rocket", "ship", "launch"],
  ]),
  ...T("Smileys", [
    ["😀", "grinning", "smile", "happy"],
    ["😄", "smile", "happy"],
    ["😅", "sweat_smile", "phew"],
    ["🤣", "rofl", "laugh"],
    ["😊", "blush", "shy"],
    ["😉", "wink"],
    ["😍", "heart_eyes", "love"],
    ["😘", "kissing_heart", "kiss"],
    ["😎", "sunglasses", "cool"],
    ["🤔", "thinking", "hmm"],
    ["🤨", "raised_eyebrow", "suspicious"],
    ["😐", "neutral_face", "meh"],
    ["🙄", "rolling_eyes", "eyeroll"],
    ["😴", "sleeping", "zzz", "tired"],
    ["🤯", "exploding_head", "mind_blown"],
    ["🥳", "partying_face", "party"],
    ["😬", "grimacing", "awkward"],
    ["😭", "sob", "cry"],
    ["😡", "rage", "angry", "mad"],
    ["🤡", "clown"],
    ["💀", "skull", "dead"],
    ["🤖", "robot", "bot"],
    ["👻", "ghost", "boo"],
    ["🫡", "saluting_face", "salute", "yes_sir"],
    ["🥲", "smiling_face_with_tear", "bittersweet"],
    ["😏", "smirk"],
  ]),
  ...T("Gestures", [
    ["👋", "wave", "hello", "hi", "bye"],
    ["👏", "clap", "applause", "bravo"],
    ["🙌", "raised_hands", "hooray"],
    ["🤝", "handshake", "deal"],
    ["✌️", "v", "peace"],
    ["🤞", "crossed_fingers", "luck", "hope"],
    ["👌", "ok_hand", "ok"],
    ["💪", "muscle", "strong", "flex"],
    ["🫶", "heart_hands", "love"],
    ["🤷", "shrug", "dunno"],
    ["🤦", "facepalm", "doh"],
    ["👉", "point_right"],
    ["☝️", "point_up"],
  ]),
  ...T("Objects", [
    ["💡", "bulb", "idea", "light"],
    ["📌", "pushpin", "pin"],
    ["📎", "paperclip", "attach"],
    ["🔗", "link", "url"],
    ["📝", "memo", "note", "write"],
    ["📅", "calendar", "date"],
    ["⏰", "alarm_clock", "time", "reminder"],
    ["🔒", "lock", "secure", "private"],
    ["🐛", "bug", "issue"],
    ["⚠️", "warning", "caution"],
    ["❌", "x", "no", "cross", "wrong"],
    ["❓", "question", "help"],
    ["⭐", "star", "favorite"],
    ["🏆", "trophy", "win", "champion"],
    ["🎯", "dart", "target", "goal"],
    ["🧠", "brain", "smart"],
    ["☕", "coffee", "cafe"],
    ["🍕", "pizza", "food"],
    ["🎵", "musical_note", "music", "song"],
    ["📣", "mega", "announcement", "megaphone"],
    ["🎨", "art", "palette", "design"],
    ["🛠️", "hammer_and_wrench", "tools", "build", "fix"],
    ["📦", "package", "box", "release", "ship"],
    ["✨", "sparkles", "new", "shiny", "magic"],
    ["💬", "speech_balloon", "chat", "comment"],
  ]),
];

const STANDARD_BY_NAME = new Map(STANDARD_EMOJI.map((e) => [e.name, e]));

export const SHORTCODE_RE = /:([a-z0-9_+-]{2,32}):/g;

/** Resolves a shortcode (without colons) to a standard emoji character. */
export function standardEmojiFor(name: string): string | undefined {
  return STANDARD_BY_NAME.get(name)?.char;
}

export function customEntries(custom: CustomEmoji[]): EmojiEntry[] {
  return custom.map((c) => ({ name: c.name, url: c.url, keywords: [], group: "Custom", custom: true }));
}

/** Fuzzy-ish search: prefix matches on the name first, then substring on name/keywords. */
export function searchEmoji(query: string, custom: CustomEmoji[], limit = 12): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:/, "");
  const all = [...customEntries(custom), ...STANDARD_EMOJI];
  if (!q) return all.slice(0, limit);
  const prefix: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const e of all) {
    if (e.name.startsWith(q)) prefix.push(e);
    else if (e.name.includes(q) || e.keywords.some((k) => k.startsWith(q))) contains.push(e);
  }
  return [...prefix, ...contains].slice(0, limit);
}

/** Is this reaction/emoji string a custom shortcode like `:name:`? */
export function isCustomShortcode(value: string): boolean {
  return /^:[a-z0-9_]{2,32}:$/.test(value);
}

export function shortcodeName(value: string): string {
  return value.replace(/^:|:$/g, "");
}

/**
 * Prepares message text for the Markdown renderer: known custom shortcodes
 * become image syntax pointing at the workspace emoji URL and standard
 * shortcodes become their unicode character. Unknown shortcodes are left as
 * typed. Code spans/blocks are skipped so `:foo:` inside code is preserved.
 */
export function expandShortcodes(content: string, custom: Map<string, CustomEmoji>): string {
  if (!content.includes(":")) return content;
  // Split on fenced code blocks and inline code so we never rewrite inside them.
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(SHORTCODE_RE, (whole, name: string) => {
        const c = custom.get(name);
        if (c) return `![:${name}:](${c.url})`;
        const std = standardEmojiFor(name);
        return std ?? whole;
      });
    })
    .join("");
}

export const CUSTOM_EMOJI_URL_PREFIX = "/api/files/emojis/";
