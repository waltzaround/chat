import { useRef, useState, type FormEvent } from "react";
import { Loader2, Smile, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useCreateEmoji, useDeleteEmoji, useEmojis, useMembers } from "@/lib/queries";
import { uploadFile } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { memberDisplayName } from "@/lib/permissions";
import { formatFull } from "@/lib/format";
import type { CustomEmoji, WorkspaceDetail } from "@shared/types";

const NAME_RE = /^[a-z0-9_]{2,32}$/;

export function EmojisPanel({ ws }: { ws: WorkspaceDetail }) {
  const emojis = useEmojis(ws.id);
  const members = useMembers(ws.id);
  const create = useCreateEmoji(ws.id);
  const remove = useDeleteEmoji(ws.id);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CustomEmoji | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("Emojis must be images (PNG, GIF, WebP…)");
    if (f.size > 256 * 1024) return toast.error("Emojis are limited to 256 KB");
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    if (!name) {
      const guess = f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
      if (NAME_RE.test(guess)) setName(guess);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim().toLowerCase();
    if (!NAME_RE.test(trimmed)) return toast.error("Names are 2–32 lowercase letters, numbers or underscores");
    if (!file) return toast.error("Choose an image first");
    setBusy(true);
    try {
      const uploaded = await uploadFile({ file, purpose: "emoji", workspaceId: ws.id });
      await create.mutateAsync({ name: trimmed, key: uploaded.key });
      toast.success(`Added :${trimmed}:`);
      setName("");
      setFile(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(errorMessage(err, "Could not add emoji"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      toast.success(`Removed :${pendingDelete.name}:`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  };

  const byUser = new Map((members.data ?? []).map((m) => [m.userId, m]));
  const list = emojis.data ?? [];

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold">Custom emojis</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Members can use these anywhere by typing <code className="rounded bg-muted px-1 font-mono text-xs">:name:</code> in a message or picking them from the emoji picker. Square images around 128×128 look best; up to 256 KB, {list.length}/250 used.
        </p>
      </section>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={file ? `Change image (${file.name})` : "Choose emoji image"}
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed bg-muted/40 text-muted-foreground hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {preview ? <img src={preview} alt="" className="size-12 object-contain" /> : <Upload className="size-5" aria-hidden />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => pickFile(e.target.files?.[0])} />
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="emoji-name">Name</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">:</span>
            <Input id="emoji-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="party_parrot" maxLength={32} pattern="[a-z0-9_]{2,32}" className="px-5 font-mono" />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">:</span>
          </div>
        </div>
        <Button type="submit" disabled={busy || !file || !NAME_RE.test(name)}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Smile className="size-4" aria-hidden />}
          Add emoji
        </Button>
      </form>

      <section aria-label="Existing emojis">
        {emojis.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No custom emojis yet. Upload one above — it will be available to everyone in the workspace immediately.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {list.map((e) => {
              const creator = e.createdBy ? byUser.get(e.createdBy) : undefined;
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <img src={e.url} alt={`:${e.name}:`} className="size-8 object-contain" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">:{e.name}:</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {creator ? `Added by ${memberDisplayName(creator)} · ` : ""}
                      {formatFull(e.createdAt)}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Delete :${e.name}:`} onClick={() => setPendingDelete(e)}>
                    <Trash2 className="size-4 text-destructive" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete :{pendingDelete?.name}:?</AlertDialogTitle>
            <AlertDialogDescription>Existing messages will show the shortcode as plain text instead of the image.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
