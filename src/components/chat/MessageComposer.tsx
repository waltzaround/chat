import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { FileIcon, Loader2, Paperclip, SmilePlus, X } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { Permission, hasPermission } from "@/lib/permissions";
import { uploadFile } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { EmojiPicker } from "./EmojiPicker";
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

const draftKey = (channelId: string) => `commons.draft.${channelId}`;

export function MessageComposer({
  channel,
  reply,
  onClearReply,
  editing,
  onDoneEditing,
  disabled,
}: {
  channel: Channel;
  reply: ComposerReply | null;
  onClearReply: () => void;
  editing: Message | null;
  onDoneEditing: () => void;
  disabled: boolean;
}) {
  const rt = useRealtime();
  const [value, setValue] = useState(() => (editing ? editing.content : localStorage.getItem(draftKey(channel.id)) ?? ""));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canAttach = hasPermission(channel.permissions, Permission.ATTACH_FILES) && !editing;

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
      setValue(localStorage.getItem(draftKey(channel.id)) ?? "");
    }
  }, [editing, channel.id]);

  // Persist drafts (not while editing).
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => {
      if (value.trim()) localStorage.setItem(draftKey(channel.id), value);
      else localStorage.removeItem(draftKey(channel.id));
    }, 300);
    return () => clearTimeout(t);
  }, [value, channel.id, editing]);

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
    rt.sendMessage({ channelId: channel.id, content, attachments, replyTo: reply });
    rt.stopTyping(channel.id);
    setValue("");
    localStorage.removeItem(draftKey(channel.id));
    for (const u of uploads) if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
    setUploads([]);
    onClearReply();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  const onChange = (v: string) => {
    setValue(v);
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

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setValue(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const placeholder = disabled
    ? "You do not have permission to send messages here"
    : editing
      ? "Edit your message"
      : `Message ${channel.kind === "text" ? "#" : ""}${channel.name}`;
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
      {editing ? (
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">
            Editing message · <kbd className="rounded border px-1 font-mono">Esc</kbd> to cancel, <kbd className="rounded border px-1 font-mono">Enter</kbd> to save
          </span>
          <button type="button" onClick={onDoneEditing} className="text-primary hover:underline">
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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => rt.stopTyping(channel.id)}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH + 200}
          aria-label={placeholder}
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
            <EmojiPicker onPick={insertEmoji} />
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
