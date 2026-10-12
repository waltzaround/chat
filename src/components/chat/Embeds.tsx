import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ActionRow, ButtonComponent, CustomEmoji, Embed, Message } from "@shared/types";
import { errorMessage } from "@/lib/api";
import { pressButton } from "@/lib/integrations";
import { formatFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { Markdown } from "./Markdown";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/** Rich cards from apps, and link previews. */
export function Embeds({ embeds, emojis }: { embeds: Embed[]; emojis?: Map<string, CustomEmoji> }) {
  if (embeds.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {embeds.map((embed, i) => (
        <EmbedCard key={`${embed.url ?? ""}-${i}`} embed={embed} emojis={emojis} />
      ))}
    </div>
  );
}

function EmbedLink({ href, className, children }: { href?: string; className?: string; children: React.ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn("hover:underline", className)}>
      {children}
    </a>
  );
}

function EmbedCard({ embed, emojis }: { embed: Embed; emojis?: Map<string, CustomEmoji> }) {
  const inline = embed.fields ?? [];
  return (
    <div
      className="grid max-w-[520px] overflow-hidden rounded-md border border-l-4 bg-card/60 text-sm"
      style={{ borderLeftColor: embed.color !== undefined ? hex(embed.color) : "var(--border)" }}
    >
      <div className={cn("grid gap-1.5 p-3", embed.thumbnail && "grid-cols-[minmax(0,1fr)_auto] gap-x-3")}>
        <div className="grid min-w-0 gap-1.5">
          {embed.provider ? (
            <EmbedLink href={embed.provider.url} className="text-xs text-muted-foreground">
              {embed.provider.name}
            </EmbedLink>
          ) : null}
          {embed.author ? (
            <div className="flex min-w-0 items-center gap-2">
              {embed.author.iconUrl ? <img src={embed.author.iconUrl} alt="" className="size-5 shrink-0 rounded-full object-cover" loading="lazy" /> : null}
              <EmbedLink href={embed.author.url} className="truncate text-xs font-semibold">
                {embed.author.name}
              </EmbedLink>
            </div>
          ) : null}
          {embed.title ? (
            <EmbedLink href={embed.url} className={cn("font-semibold [overflow-wrap:anywhere]", embed.url && "link")}>
              {embed.title}
            </EmbedLink>
          ) : null}
          {embed.description ? (
            <div className="message-body text-[0.9rem] text-foreground/90">
              <Markdown content={embed.description} emojis={emojis} />
            </div>
          ) : null}
          {inline.length ? (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
              {inline.map((field, i) => (
                <div key={i} className={cn("min-w-0", !field.inline && "sm:col-span-3")}>
                  <dt className="text-xs font-semibold">{field.name}</dt>
                  <dd className="message-body text-[0.85rem] text-foreground/90">
                    <Markdown content={field.value} emojis={emojis} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {embed.thumbnail ? <img src={embed.thumbnail.url} alt="" className="row-span-full size-20 rounded object-cover" loading="lazy" /> : null}
      </div>
      {embed.image ? (
        <EmbedLink href={embed.url ?? embed.image.url} className="block px-3 pb-3">
          <img
            src={embed.image.url}
            alt=""
            loading="lazy"
            className="max-h-80 max-w-full rounded object-contain"
            style={embed.image.width && embed.image.height ? { aspectRatio: `${embed.image.width} / ${embed.image.height}` } : undefined}
          />
        </EmbedLink>
      ) : null}
      {embed.footer || embed.timestamp ? (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 text-[11px] text-muted-foreground">
          {embed.footer?.iconUrl ? <img src={embed.footer.iconUrl} alt="" className="size-4 rounded-full object-cover" loading="lazy" /> : null}
          {embed.footer ? <span className="truncate">{embed.footer.text}</span> : null}
          {embed.footer && embed.timestamp ? <span aria-hidden>·</span> : null}
          {embed.timestamp ? <time dateTime={embed.timestamp}>{formatFull(embed.timestamp)}</time> : null}
        </div>
      ) : null}
    </div>
  );
}

const STYLE: Record<ButtonComponent["style"], string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  success: "bg-success text-white hover:bg-success/90",
  danger: "bg-destructive text-white hover:bg-destructive/90",
  link: "bg-secondary text-secondary-foreground hover:bg-accent",
};

/** A bot's buttons. Pressing one asks the bot; its answer shows here or only to you. */
export function MessageButtons({ message, rows }: { message: Message; rows: ActionRow[] }) {
  const rt = useRealtime();
  const [busy, setBusy] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const press = async (button: ButtonComponent) => {
    if (!button.customId || busy) return;
    setBusy(button.customId);
    try {
      const result = await pressButton(message.channelId, message.id, button.customId);
      if (result.message?.ephemeral) rt.addEphemeral(result.message);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {rows.map((row, r) => (
        <div key={r} className="flex flex-wrap gap-1.5">
          {row.components.map((button, b) => {
            const className = cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
              STYLE[button.style],
            );
            if (button.style === "link" && button.url) {
              return (
                <a key={b} href={button.url} target="_blank" rel="noopener noreferrer nofollow ugc" className={cn(className, button.disabled && "pointer-events-none opacity-50")} aria-disabled={button.disabled}>
                  {button.label}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              );
            }
            // A private reply isn't stored, so its buttons have nothing to answer to.
            const disabled = button.disabled || !!message.ephemeral;
            return (
              <button key={b} type="button" className={className} disabled={disabled || busy !== null} onClick={() => void press(button)}>
                {busy === button.customId ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                {button.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The small "APP" label after an app's name. */
export function AppBadge() {
  return (
    <span className="rounded-sm bg-secondary px-1 py-px text-[10px] font-semibold tracking-wide text-muted-foreground uppercase" title="An app: a bot, webhook or integration">
      App
    </span>
  );
}
