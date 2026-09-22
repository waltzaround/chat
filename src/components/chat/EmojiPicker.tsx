import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

const GROUPS: { name: string; emoji: [string, string][] }[] = [
  {
    name: "Frequent",
    emoji: [["👍", "thumbs up"], ["❤️", "heart"], ["😂", "joy laugh"], ["🎉", "party tada"], ["👀", "eyes"], ["🔥", "fire"], ["✅", "check done"], ["🙏", "pray thanks"], ["😮", "wow open mouth"], ["😢", "cry sad"], ["💯", "hundred"], ["🚀", "rocket ship"]],
  },
  {
    name: "Smileys",
    emoji: [["😀", "grin"], ["😄", "smile"], ["😅", "sweat smile"], ["🤣", "rofl"], ["😊", "blush"], ["😉", "wink"], ["😍", "heart eyes"], ["😘", "kiss"], ["😎", "cool sunglasses"], ["🤔", "thinking"], ["🤨", "raised eyebrow"], ["😐", "neutral"], ["🙄", "eye roll"], ["😴", "sleep"], ["🤯", "mind blown"], ["🥳", "party face"], ["😬", "grimace"], ["😭", "sob"], ["😡", "angry"], ["🤡", "clown"], ["💀", "skull"], ["🤖", "robot"], ["👻", "ghost"], ["🫡", "salute"]],
  },
  {
    name: "Gestures",
    emoji: [["👎", "thumbs down"], ["👋", "wave hello"], ["👏", "clap"], ["🙌", "raised hands"], ["🤝", "handshake"], ["✌️", "peace"], ["🤞", "fingers crossed"], ["👌", "ok"], ["💪", "muscle strong"], ["🫶", "heart hands"], ["🤷", "shrug"], ["🤦", "facepalm"]],
  },
  {
    name: "Objects",
    emoji: [["💡", "idea bulb"], ["📌", "pin"], ["📎", "paperclip"], ["🔗", "link"], ["📝", "memo note"], ["📅", "calendar"], ["⏰", "alarm clock"], ["🔒", "lock"], ["🐛", "bug"], ["⚠️", "warning"], ["❌", "cross no"], ["❓", "question"], ["⭐", "star"], ["🏆", "trophy"], ["🎯", "target"], ["🧠", "brain"], ["☕", "coffee"], ["🍕", "pizza"], ["🎵", "music"], ["📣", "megaphone"]],
  },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    const hits = GROUPS.flatMap((g) => g.emoji.filter(([, name]) => name.includes(q)));
    return [{ name: "Results", emoji: hits }];
  }, [query]);

  return (
    <div className="w-72 p-2" role="dialog" aria-label="Emoji picker">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji" className="mb-2 h-8" autoFocus aria-label="Search emoji" />
      <div className="max-h-56 overflow-y-auto">
        {filtered.map((g) => (
          <div key={g.name} className="mb-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emoji.map(([e, name]) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onPick(e)}
                  aria-label={name}
                  title={name}
                  className="flex size-8 items-center justify-center rounded text-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {e}
                </button>
              ))}
            </div>
            {g.emoji.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">No matches</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
