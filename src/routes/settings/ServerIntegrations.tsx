import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Bot, BotSecrets } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { ImagePicker } from "@/components/common/ImagePicker";
import { GitHubMark } from "@/components/common/GitHubMark";
import { errorMessage } from "@/lib/api";
import { formatFull } from "@/lib/format";
import { useServerSettings, useUpdateServerSettings } from "@/lib/queries";
import { useForgetGitHubApp, useGitHubAccount, useGitHubStatus, useServerBotMutations, useServerBots, useUnlinkGitHub } from "@/lib/integrations";

function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" size="icon" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Link previews
// ---------------------------------------------------------------------------

export function LinkPreviewsSetting() {
  const settings = useServerSettings().data;
  const update = useUpdateServerSettings();
  if (!settings) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div>
        <p className="text-sm font-medium">Link previews</p>
        <p className="text-xs text-muted-foreground">Links in messages get a card with the page's title and image. This server fetches each page once; readers never contact the site.</p>
      </div>
      <Switch
        checked={settings.linkPreviews}
        disabled={update.isPending}
        onCheckedChange={(v) => update.mutate({ linkPreviews: v }, { onError: (err) => toast.error(errorMessage(err)) })}
        aria-label="Link previews"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apps (bots)
// ---------------------------------------------------------------------------

export function ServerBotsSection() {
  const bots = useServerBots();
  const { create, update, newToken, newSigningSecret, remove } = useServerBotMutations();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [secrets, setSecrets] = useState<BotSecrets | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium">Apps</p>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> New app
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        An app is a bot account your own code controls, with a token for the API and an events URL for messages and slash commands. Workspace admins add apps to their workspaces. The developer guide is in docs/integrations.md.
      </p>
      {bots.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading apps" />
      ) : bots.data?.length ? (
        <ul className="divide-y rounded-md border">
          {bots.data.map((b) => (
            <li key={b.id} className="grid gap-1 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <UserAvatar user={b} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {b.displayName} <span className="font-normal text-muted-foreground">@{b.username}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Token …{b.tokenHint} · in {b.workspaceCount} workspace{b.workspaceCount === 1 ? "" : "s"} · {b.lastUsedAt ? `used ${formatFull(b.lastUsedAt)}` : "not used yet"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                  Edit
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleting(b)} aria-label={`Delete ${b.displayName}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              {b.eventsPaused ? (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden /> Events are paused after {b.eventsFailures} failed deliveries. Fix the events URL and save it again to resume.
                </p>
              ) : b.eventsUrl ? (
                <p className="truncate text-xs text-muted-foreground">Events go to {b.eventsUrl}</p>
              ) : (
                <p className="text-xs text-muted-foreground">No events URL: it can post, but can't hear messages or commands.</p>
              )}
              {b.commands.length ? <p className="truncate text-xs text-muted-foreground">Commands: {b.commands.map((c) => `/${c.name}`).join(" ")}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No apps yet.</p>
      )}

      <CreateBotDialog
        open={creating}
        onOpenChange={setCreating}
        busy={create.isPending}
        onCreate={(input) =>
          create.mutate(input, {
            onSuccess: (s) => {
              setCreating(false);
              setSecrets(s);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
      {editing ? (
        <EditBotDialog
          bot={editing}
          onClose={() => setEditing(null)}
          busy={update.isPending}
          onSave={(input) =>
            update.mutate(
              { id: editing.id, ...input },
              {
                onSuccess: () => {
                  setEditing(null);
                  toast.success("App saved");
                },
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }
          onNewToken={() => newToken.mutate(editing.id, { onSuccess: (s) => { setEditing(null); setSecrets(s); }, onError: (err) => toast.error(errorMessage(err)) })}
          onNewSigningSecret={() => newSigningSecret.mutate(editing.id, { onSuccess: (s) => { setEditing(null); setSecrets(s); }, onError: (err) => toast.error(errorMessage(err)) })}
        />
      ) : null}
      <Dialog open={!!secrets} onOpenChange={(o) => !o && setSecrets(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{secrets?.bot.displayName}'s credentials</DialogTitle>
            <DialogDescription>Copy these into your app's configuration now. For security they aren't shown again; you can replace them from Edit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {secrets?.token ? <CopyField id="bot-token" label="Token (send as Authorization: Bot <token>)" value={secrets.token} /> : null}
            {secrets?.signingSecret ? <CopyField id="bot-signing" label="Signing secret (checks X-Chat-Signature)" value={secrets.signingSecret} /> : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setSecrets(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>It leaves every workspace and its token stops working. Its old messages stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove.mutate(deleting.id, { onError: (err) => toast.error(errorMessage(err)) })}>
              Delete app
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateBotDialog({ open, onOpenChange, busy, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onCreate: (input: { name: string; description?: string }) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onCreate({ name: name.trim(), description: description.trim() || undefined });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New app</DialogTitle>
            <DialogDescription>You'll get its token and signing secret next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="bot-name">Name</Label>
            <Input id="bot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploy Bot" maxLength={48} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bot-description">What it does</Label>
            <Textarea id="bot-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} placeholder="Shown to admins when they add it" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Create app
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBotDialog({
  bot,
  onClose,
  busy,
  onSave,
  onNewToken,
  onNewSigningSecret,
}: {
  bot: Bot;
  onClose: () => void;
  busy: boolean;
  onSave: (input: { name: string; description: string | null; eventsUrl?: string | null; avatarKey?: string | null }) => void;
  onNewToken: () => void;
  onNewSigningSecret: () => void;
}) {
  const [name, setName] = useState(bot.displayName);
  const [description, setDescription] = useState(bot.description ?? "");
  const [eventsUrl, setEventsUrl] = useState(bot.eventsUrl ?? "");
  const [avatarKey, setAvatarKey] = useState<string | null | undefined>(undefined);
  const urlChanged = eventsUrl.trim() !== (bot.eventsUrl ?? "") || bot.eventsPaused;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ name: name.trim(), description: description.trim() || null, ...(urlChanged ? { eventsUrl: eventsUrl.trim() || null } : {}), ...(avatarKey !== undefined ? { avatarKey } : {}) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {bot.displayName}</DialogTitle>
          </DialogHeader>
          <ImagePicker purpose="avatar" value={avatarKey ?? null} onChange={setAvatarKey} label="App avatar" fallbackText={name} currentUrl={avatarKey === null ? null : bot.avatarUrl} />
          <div className="grid gap-1.5">
            <Label htmlFor="bot-edit-name">Name</Label>
            <Input id="bot-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bot-edit-description">What it does</Label>
            <Textarea id="bot-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bot-edit-events">Events URL</Label>
            <Input id="bot-edit-events" value={eventsUrl} onChange={(e) => setEventsUrl(e.target.value)} placeholder="https://bot.example.com/events" inputMode="url" />
            <p className="text-xs text-muted-foreground">Saving sends a signed ping, which must get a 2xx answer. Messages and slash commands are delivered here.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onNewToken}>
              <KeyRound className="size-3.5" aria-hidden /> New token
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onNewSigningSecret}>
              <KeyRound className="size-3.5" aria-hidden /> New signing secret
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The server's GitHub App
// ---------------------------------------------------------------------------

/** Shows a toast for ?github=... after a trip to GitHub, then tidies the URL. */
function useGitHubReturn() {
  const [params, setParams] = useSearchParams();
  const outcome = params.get("github");
  useEffect(() => {
    if (!outcome) return;
    const messages: Record<string, () => void> = {
      created: () => toast.success("GitHub App created. Now install it on your account or organisation."),
      installed: () => toast.success("GitHub App installed"),
      linked: () => toast.success("GitHub account linked"),
      failed: () => toast.error("GitHub didn't link your account. Try again."),
    };
    messages[outcome]?.();
    setParams(
      (p) => {
        p.delete("github");
        return p;
      },
      { replace: true },
    );
  }, [outcome, setParams]);
}

export function GitHubAppSection() {
  useGitHubReturn();
  const status = useGitHubStatus();
  const forget = useForgetGitHubApp();
  const [org, setOrg] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const start = () => {
    const params = new URLSearchParams();
    if (org.trim()) params.set("org", org.trim());
    window.location.assign(`/api/github/app/new${params.size ? `?${params}` : ""}`);
  };
  return (
    <div className="grid gap-2">
      <p className="flex items-center gap-2 text-sm font-medium">
        <GitHubMark className="size-4" /> GitHub
      </p>
      {status.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading GitHub status" />
      ) : status.data?.configured ? (
        <div className="grid gap-2 rounded-md border px-4 py-3 text-sm">
          <p>
            Connected as{" "}
            <a href={status.data.htmlUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="link font-medium">
              {status.data.name}
            </a>
            .{" "}
            {status.data.installations.length ? `Installed on ${status.data.installations.map((i) => i.account).join(", ")}.` : "It isn't installed on any account yet."}
          </p>
          <p className="text-xs text-muted-foreground">Workspace admins subscribe channels to repositories in their Integrations settings, or with /github in a channel. Links to issues and pull requests get previews.</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={status.data.installUrl ?? "#"} target="_blank" rel="noopener noreferrer">
                Install on an account or organisation
              </a>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmForget(true)}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 rounded-md border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Create this server's own GitHub App in one step. GitHub asks you to confirm, then sends you back here. It lets channels follow repositories, previews issue and pull request links, and adds Close and Reopen buttons that act as whoever presses them.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="gh-org">Owned by an organisation (optional)</Label>
            <Input id="gh-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Leave blank to own it yourself" />
          </div>
          <div>
            <Button size="sm" onClick={start}>
              <GitHubMark className="size-4" /> Create the GitHub App
            </Button>
          </div>
        </div>
      )}
      <AlertDialog open={confirmForget} onOpenChange={setConfirmForget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription>Subscriptions stop posting and buttons stop working. The app still exists on GitHub; delete it there too if you're done with it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => forget.mutate(undefined, { onError: (err) => toast.error(errorMessage(err)) })}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Your GitHub account (Profile)
// ---------------------------------------------------------------------------

export function GitHubAccountSection() {
  useGitHubReturn();
  const account = useGitHubAccount();
  const unlink = useUnlinkGitHub();
  if (!account.data?.available) return null;
  return (
    <section className="grid gap-2" aria-labelledby="github-account-heading">
      <h2 id="github-account-heading" className="text-base font-semibold">
        Connected accounts
      </h2>
      <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
        <div className="flex items-center gap-3">
          <GitHubMark className="size-5" />
          <div>
            <p className="text-sm font-medium">GitHub</p>
            <p className="text-xs text-muted-foreground">{account.data.login ? `Linked as ${account.data.login}. Buttons like "Close issue" act as you.` : "Link it so buttons like \"Close issue\" act as you."}</p>
          </div>
        </div>
        {account.data.login ? (
          <Button size="sm" variant="outline" onClick={() => unlink.mutate(undefined, { onError: (err) => toast.error(errorMessage(err)) })}>
            Unlink
          </Button>
        ) : (
          <Button size="sm" onClick={() => window.location.assign("/api/github/account/connect")}>
            Link GitHub
          </Button>
        )}
      </div>
    </section>
  );
}
