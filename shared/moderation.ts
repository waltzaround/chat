/** Slow mode choices, in seconds (0 = off). */
export const SLOWMODE_OPTIONS = [0, 5, 10, 30, 60, 300, 900, 3600, 21600] as const;

export function formatSlowmode(seconds: number): string {
  if (seconds <= 0) return "Off";
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
}

/** The terms in a word filter: one per line, trimmed, lowercase, no blanks. */
export function filterTerms(filter: string): string[] {
  return [...new Set(filter.split("\n").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first filtered term in `content`, matching whole words or phrases, ignoring case. */
export function findFilteredTerm(content: string, filter: string): string | null {
  const text = content.toLowerCase();
  for (const term of filterTerms(filter)) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(term)}($|[^\\p{L}\\p{N}_])`, "u").test(text)) return term;
  }
  return null;
}
