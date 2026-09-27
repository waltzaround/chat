import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { FileIcon, Loader2, Paperclip, SmilePlus, X } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { Permission, hasPermission } from "@/lib/permissions";
import { uploadFile } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useEmojis, useMe, useMembers } from "@/lib/queries";
import type { EmojiEntry } from "@/lib/emoji";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { EmojiPicker } from "./EmojiPicker";
import { EmojiAutocomplete, findShortcodeAtCaret, useAutocompleteResults, type ShortcodeMatch } from "./EmojiAutocomplete";
import { MentionAutocomplete, findMentionAtCaret, useMentionSuggestions, type MentionOption } from "./MentionAutocomplete";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BYTES, MESSAGE_MAX_LENGTH } from "@shared/schemas";
import type { Attachment, Channel, Message, ReplyContext } from "@shared/types";

export type ComposerReply = ReplyContext;

interface Upload {
  localId: string;
  file: File;
  progress: number;
  attachment: Attachment | null;
  error: string | null;
  controller: AbortController;
  previewUrl: string | null;
}

const draftKey = (channelId: string) => `chat.draft.${channelId}`;

export function MessageComposer({
  channel,
  reply,
  onClearReply,
  editing,
  onDoneEditing,
  disabled,
  placeholderName,
  disabledReason,
  threadRootId,
  placeholderText,
}: {
  channel: Channel;
  reply: ComposerReply | null;
  onClearReply: () => void;
  editing: Message | null;
  onDoneEditing: () => void;
  disabled: boolean;
  /** Who you're writing to, when it isn't a channel (a direct message). */
  placeholderName?: string;
  /** Why sending is off, shown instead of the generic permission message. */
  disabledReason?: string;
  /** Send into this thread; the draft is kept separately from the channel's. */
  threadRootId?: string;
  /** Replaces the whole "Message #channel" placeholder. */
  placeholderText?: string;
}) {
  const draftId = threadRootId ? `${channel.id}:${threadRootId}` : channel.id;
  const rt = useRealtime();
  const customEmojis = useEmojis(channel.workspaceId).data ?? [];
  const [value, setValue] = useState(() => (editing ? editing.content : localStorage.getItem(draftKey(draftId)) ?? ""));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [match, setMatch] = useState<ShortcodeMatch | null>(null);
  const [selected, setSelected] = useState(0);
  const dismissedFor = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canAttach = hasPermission(channel.permissions, Permission.ATTACH_FILES) && !editing;
  const suggestions = useAutocompleteResults(match, customEmojis);
  const [mention, setMention] = useState<ShortcodeMatch | null>(null);
  const members = useMembers(channel.workspaceId).data;
  const meId = useMe().data?.id;
  const mentionOptions = useMentionSuggestions(mention, members, hasPermission(channel.permissions, Permission.MENTION_EVERYONE), meId);
  const emojiActive = !!match && suggestions.length > 0;
  const mentionActive = !emojiActive && !!mention && mentionOptions.length > 0;

  // Enter/leave edit mode.
  useEffect(() => {
    if (editing) {
      setValue(editing.content);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } else {
      setValue(localStorage.getItem(draftKey(draftId)) ?? "");
    }
    setMatch(null);
  }, [editing, draftId]);

  // Persist drafts (not while editing).
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => {
      if (value.trim()) localStorage.setItem(draftKey(draftId), value);
      else localStorage.removeItem(draftKey(draftId));
    }, 300);
    return () => clearTimeout(t);
  }, [value, draftId, editing]);

  useEffect(() => {
    if (reply) textareaRef.current?.focus();
  }, [reply]);

  // Autosize.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);

  /** Recompute the `:shortcode` under the caret; called after any edit or caret move. */
  const refreshMatch = useCallback((text: string, caret: number) => {
    const at = findMentionAtCaret(text, caret);
    const atDismissed = at && dismissedFor.current === `@${at.start}:${at.query}`;
    setMention((prev) => (atDismissed || !at ? null : prev?.start === at.start && prev?.query === at.query ? prev : at));
    if (!at || at.query !== mention?.query) setSelected(0);
    const m = findShortcodeAtCaret(text, caret);
    if (m && dismissedFor.current === `${m.start}:${m.query}`) return setMatch(null);
    if (!m) dismissedFor.current = null;
    setMatch((prev) => (prev?.start === m?.start && prev?.query === m?.query ? prev : m));
    if (!m || m.query !== match?.query) setSelected(0);
  }, [match?.query, mention?.query]);

  const insertMention = useCallback(
    (option: MentionOption, range: { start: number; end: number }) => {
      const el = textareaRef.current;
      const insertion = `@${option.username} `;
      const next = value.slice(0, range.start) + insertion + value.slice(range.end);
      setValue(next);
      setMention(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(range.start + insertion.length, range.start + insertion.length);
      });
    },
    [value],
  );

  const insertEmoji = useCallback(
    (entry: EmojiEntry, range?: { start: number; end: number }) => {
      const el = textareaRef.current;
      const start = range?.start ?? el?.selectionStart ?? value.length;
      const end = range?.end ?? el?.selectionEnd ?? value.length;
      const token = entry.custom ? `:${entry.name}:` : entry.char!;
      const insertion = `${token} `;
      const next = value.slice(0, start) + insertion + value.slice(end);
      setValue(next);
      setMatch(null);
      setEmojiOpen(false);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + insertion.length, start + insertion.length);
      });
    },
    [value],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!canAttach) return;
      const list = Array.from(files);
      if (uploads.length + list.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        return;
      }
      for (const file of list) {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(`${file.name} is larger than ${formatBytes(MAX_UPLOAD_BYTES)}`);
          continue;
        }
        const localId = crypto.randomUUID();
        const controller = new AbortController();
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
        setUploads((u) => [...u, { localId, file, progress: 0, attachment: null, error: null, controller, previewUrl }]);
        void uploadFile({
          file,
          purpose: "attachment",
          channelId: channel.id,
          signal: controller.signal,
          onProgress: (p) => setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, progress: p.total ? p.loaded / p.total : 0 } : x))),
        })
          .then((attachment) => setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, attachment, progress: 1 } : x))))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            setUploads((u) => u.map((x) => (x.localId === localId ? { ...x, error: errorMessage(err, "Upload failed") } : x)));
          });
      }
    },
    [canAttach, channel.id, uploads.length],
  );

  const removeUpload = (localId: string) => {
    setUploads((u) => {
      const target = u.find((x) => x.localId === localId);
      target?.controller.abort();
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return u.filter((x) => x.localId !== localId);
    });
  };

  const send = () => {
    const content = value.trim();
    if (editing) {
      if (!content) return;
      if (content !== editing.content) rt.send({ type: "message.edit", messageId: editing.id, content });
      onDoneEditing();
      setValue("");
      return;
    }
    if (uploads.some((u) => !u.attachment && !u.error)) {
      toast.message("Still uploading…", { description: "Your files will be attached once the upload finishes." });
      return;
    }
    const attachments = uploads.filter((u) => u.attachment).map((u) => u.attachment!);
    if (!content && attachments.length === 0) return;
    if (content.length > MESSAGE_MAX_LENGTH) {
      toast.error(`Messages are limited to ${MESSAGE_MAX_LENGTH.toLocaleString()} characters`);
      return;
    }
    rt.sendMessage({ channelId: channel.id, content, attachments, replyTo: reply, threadRootId: threadRootId ?? null });
    rt.stopTyping(channel.id);
    setValue("");
    setMatch(null);
    setMention(null);
    localStorage.removeItem(draftKey(draftId));
    for (const u of uploads) if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
    setUploads([]);
    onClearReply();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete navigation takes precedence while suggestions are showing.
    if (mentionActive && mention) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSelected((i) => (i + step + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionOptions[selected] ?? mentionOptions[0]!, mention);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedFor.current = `@${mention.start}:${mention.query}`;
        setMention(null);
        return;
      }
    }
    if (match && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertEmoji(suggestions[selected] ?? suggestions[0]!, { start: match.start, end: match.end });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissedFor.current = `${match.start}:${match.query}`;
        setMatch(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      if (editing) {
        onDoneEditing();
        setValue("");
      } else if (reply) onClearReply();
    }
  };

  const onChange = (v: string, caret: number) => {
    setValue(v);
    refreshMatch(v, caret);
    if (!editing && v.trim()) rt.startTyping(channel.id);
    if (!v.trim()) rt.stopTyping(channel.id);
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length && canAttach) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const placeholder = disabled
    ? (disabledReason ?? "You do not have permission to send messages here")
    : editing
      ? "Edit your message"
      : (placeholderText ?? `Message ${placeholderName ?? `${channel.kind === "text" ? "#" : ""}${channel.name}`}`);
  const remaining = MESSAGE_MAX_LENGTH - value.length;

  return (
    <div
      className={cn("relative rounded-lg border bg-card transition-colors focus-within:border-ring/60", dragging && "border-primary bg-primary/5", disabled && "opacity-70")}
      onDragOver={(e) => {
        if (!canAttach) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {mentionActive && mention ? (
        <MentionAutocomplete options={mentionOptions} selected={selected} onSelectedChange={setSelected} onPick={(o) => insertMention(o, mention)} />
      ) : null}
      {match && suggestions.length > 0 ? (
        <EmojiAutocomplete match={match} customEmojis={customEmojis} selected={selected} onSelectedChange={setSelected} onPick={(entry) => insertEmoji(entry, { start: match.start, end: match.end })} />
      ) : null}

      {editing ? (
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">
            Editing message · <kbd className="rounded border px-1 font-mono">Esc</kbd> to cancel, <kbd className="rounded border px-1 font-mono">Enter</kbd> to save
          </span>
          <button type="button" onClick={onDoneEditing} className="link">
            Cancel
          </button>
        </div>
      ) : reply ? (
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
          <span className="truncate text-muted-foreground">
            Replying to <span className="font-medium text-foreground">{reply.author?.displayName ?? "message"}</span>
          </span>
          <button type="button" onClick={onClearReply} aria-label="Cancel reply" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {uploads.length ? (
        <ul className="flex flex-wrap gap-2 border-b p-2" aria-label="Attachments">
          {uploads.map((u) => (
            <li key={u.localId} className="relative w-40 rounded-md border bg-muted/40 p-2 text-xs">
              <button type="button" onClick={() => removeUpload(u.localId)} aria-label={`Remove ${u.file.name}`} className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground">
                <X className="size-3" aria-hidden />
              </button>
              <div className="mb-1.5 flex h-20 items-center justify-center overflow-hidden rounded bg-background/60">
                {u.previewUrl ? <img src={u.previewUrl} alt="" className="size-full object-cover" /> : <FileIcon className="size-8 text-muted-foreground" aria-hidden />}
              </div>
              <p className="truncate font-medium" title={u.file.name}>
                {u.file.name}
              </p>
              {u.error ? (
                <p className="text-destructive">{u.error}</p>
              ) : u.attachment ? (
                <p className="text-muted-foreground">{formatBytes(u.file.size)}</p>
              ) : (
                <Progress value={Math.round(u.progress * 100)} className="mt-1 h-1" aria-label={`Uploading ${u.file.name}`} />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-1 px-2 py-1.5">
        {canAttach ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach files" disabled={disabled} className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50">
                <Paperclip className="size-[18px]" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>Attach files</TooltipContent>
          </Tooltip>
        ) : null}
        <input ref={fileInputRef} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") refreshMatch(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }}
          onClick={(e) => refreshMatch(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onPaste={onPaste}
          onBlur={() => {
            rt.stopTyping(channel.id);
            // Delay so a mousedown on a suggestion can insert before the list disappears.
            setTimeout(() => {
              setMatch(null);
              setMention(null);
            }, 120);
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH + 200}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={mentionActive ? "mention-autocomplete" : emojiActive ? "emoji-autocomplete" : undefined}
          aria-activedescendant={mentionActive ? `mention-option-${selected}` : emojiActive ? `emoji-option-${selected}` : undefined}
          className="max-h-80 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[0.95rem] leading-snug outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {remaining < 200 ? (
          <span className={cn("mb-1.5 text-[11px] tabular-nums", remaining < 0 ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {remaining}
          </span>
        ) : null}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Insert emoji" disabled={disabled} className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50">
              <SmilePlus className="size-[18px]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-auto p-0">
            <EmojiPicker
              customEmojis={customEmojis}
              onPick={(token) => {
                const el = textareaRef.current;
                const start = el?.selectionStart ?? value.length;
                const end = el?.selectionEnd ?? value.length;
                const next = `${value.slice(0, start)}${token} ${value.slice(end)}`;
                setValue(next);
                setEmojiOpen(false);
                requestAnimationFrame(() => {
                  el?.focus();
                  el?.setSelectionRange(start + token.length + 1, start + token.length + 1);
                });
              }}
            />
          </PopoverContent>
        </Popover>
        {uploads.some((u) => !u.attachment && !u.error) ? <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" aria-label="Uploading" /> : null}
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 text-sm font-medium text-primary" aria-hidden>
          Drop files to attach
        </div>
      ) : null}
    </div>
  );
}
