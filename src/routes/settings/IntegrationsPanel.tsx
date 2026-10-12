import { useState, type FormEvent } from "react";
import { Bot as BotIcon, Check, Copy, Hash, Loader2, Plus, RefreshCw, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { GitHubMark as Github } from "@/components/common/GitHubMark";
import { toast } from "sonner";
import type { GitHubFeature, Webhook, WebhookSecrets, WorkspaceBot, WorkspaceDetail } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { ImagePicker } from "@/components/common/ImagePicker";
import { errorMessage } from "@/lib/api";
import { formatFull } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { useGitHubStatus, useGitHubSubscriptionMutations, useGitHubSubscriptions, useWebhookMutations, useWebhooks, useWorkspaceBotMutations, useWorkspaceBots } from "@/lib/integrations";

/** Workspace settings → Integrations: webhooks, apps and GitHub. */
export function IntegrationsPanel({ ws }: { ws: WorkspaceDetail }) {
  return (
    <div className="grid gap-8">
      <WebhooksSection ws={ws} />
      <Separator />
      <AppsSection ws={ws} />
      <Separator />
      <GitHubSection ws={ws} />
    </div>
  );
}

function textChannels(ws: WorkspaceDetail) {
  return ws.channels.filter((c) => c.kind === "text");
}

function ChannelSelect({ ws, value, onChange, id }: { ws: WorkspaceDetail; value: string; onChange: (v: string) => void; id: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose a channel" />
      </SelectTrigger>
      <SelectContent>
        {textChannels(ws).map((c) => (
          <SelectItem key={c.id} value={c.id}>
            #{c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
// Webhooks
// ---------------------------------------------------------------------------

function WebhooksSection({ ws }: { ws: WorkspaceDetail }) {
  const webhooks = useWebhooks(ws.id);
  const { create, update, regenerate, remove } = useWebhookMutations(ws.id);
  const [creating, setCreating] = useState(false);
  const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [replacing, setReplacing] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const channelName = (id: string) => ws.channels.find((c) => c.id === id)?.name ?? "deleted-channel";

  return (
    <section className="grid gap-3" aria-labelledby="webhooks-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="webhooks-heading" className="flex items-center gap-2 text-base font-semibold">
            <WebhookIcon className="size-4" aria-hidden /> Webhooks
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            A webhook is a secret URL that posts into one channel. It takes Discord's and Slack's webhook formats, so tools like GitHub Actions, Grafana, Sentry and Uptime Kuma work by pasting the URL. It takes GitHub's own deliveries too.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={textChannels(ws).length === 0}>
          <Plus className="size-4" aria-hidden /> New webhook
        </Button>
      </div>

      {webhooks.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading webhooks" />
      ) : webhooks.data?.length ? (
        <ul className="divide-y rounded-md border">
          {webhooks.data.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <UserAvatar user={{ id: w.id, displayName: w.name, avatarUrl: w.avatarUrl }} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  Posts in #{channelName(w.channelId)} · {w.lastUsedAt ? `last used ${formatFull(w.lastUsedAt)}` : "not used yet"}
                  {w.createdBy ? ` · made by ${w.createdBy.displayName}` : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(w)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setReplacing(w)}>
                  <RefreshCw className="size-3.5" aria-hidden /> New URL
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleting(w)} aria-label={`Delete ${w.name}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No webhooks yet.</p>
      )}

      <CreateWebhookDialog
        ws={ws}
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
      {editing ? <EditWebhookDialog ws={ws} webhook={editing} onClose={() => setEditing(null)} busy={update.isPending} onSave={(input) => update.mutate({ id: editing.id, ...input }, { onSuccess: () => { setEditing(null); toast.success("Webhook saved"); }, onError: (err) => toast.error(errorMessage(err)) })} /> : null}
      <SecretsDialog secrets={secrets} onClose={() => setSecrets(null)} />

      <AlertDialog open={!!replacing} onOpenChange={(o) => !o && setReplacing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace {replacing?.name}'s URL?</AlertDialogTitle>
            <AlertDialogDescription>The current URL and secret stop working straight away. Anything using them needs the new ones.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => replacing && regenerate.mutate(replacing.id, { onSuccess: setSecrets, onError: (err) => toast.error(errorMessage(err)) })}>Replace URL</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its URL stops working. Messages it already posted stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toast.success("Webhook deleted"), onError: (err) => toast.error(errorMessage(err)) })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function CreateWebhookDialog({ ws, open, onOpenChange, busy, onCreate }: { ws: WorkspaceDetail; open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onCreate: (input: { name: string; channelId: string }) => void }) {
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState(textChannels(ws)[0]?.id ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !channelId) return;
    onCreate({ name: name.trim(), channelId });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New webhook</DialogTitle>
            <DialogDescription>Its messages show this name, marked as an app.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="webhook-name">Name</Label>
            <Input id="webhook-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploys" maxLength={48} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="webhook-channel">Channel</Label>
            <ChannelSelect ws={ws} value={channelId} onChange={setChannelId} id="webhook-channel" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !channelId}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Create webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditWebhookDialog({ ws, webhook, onClose, busy, onSave }: { ws: WorkspaceDetail; webhook: Webhook; onClose: () => void; busy: boolean; onSave: (input: { name: string; channelId: string; avatarKey?: string | null }) => void }) {
  const [name, setName] = useState(webhook.name);
  const [channelId, setChannelId] = useState(webhook.channelId);
  const [avatarKey, setAvatarKey] = useState<string | null | undefined>(undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ name: name.trim(), channelId, ...(avatarKey !== undefined ? { avatarKey } : {}) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit webhook</DialogTitle>
            <DialogDescription>Tools can still pick a name and avatar for each message.</DialogDescription>
          </DialogHeader>
          <ImagePicker purpose="avatar" value={avatarKey ?? null} onChange={setAvatarKey} label="Webhook avatar" fallbackText={name} currentUrl={avatarKey === null ? null : webhook.avatarUrl} />
          <div className="grid gap-1.5">
            <Label htmlFor="webhook-edit-name">Name</Label>
            <Input id="webhook-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="webhook-edit-channel">Channel</Label>
            <ChannelSelect ws={ws} value={channelId} onChange={setChannelId} id="webhook-edit-channel" />
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

function SecretsDialog({ secrets, onClose }: { secrets: WebhookSecrets | null; onClose: () => void }) {
  return (
    <Dialog open={!!secrets} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{secrets?.webhook.name} is ready</DialogTitle>
          <DialogDescription>Copy what you need now. For security, the URL and secret aren't shown again; you can replace them later.</DialogDescription>
        </DialogHeader>
        {secrets ? (
          <div className="grid gap-4">
            <CopyField id="hook-url" label="Webhook URL (Discord format)" value={secrets.url} />
            <CopyField id="hook-slack" label="Slack-format URL" value={secrets.slackUrl} />
            <div className="grid gap-3 rounded-md border p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Github className="size-4" aria-hidden /> For a GitHub repository or organisation
              </p>
              <p className="text-xs text-muted-foreground">In GitHub, open Settings, then Webhooks, then Add webhook. Paste this URL as the Payload URL, choose application/json, paste the secret, and pick the events you want.</p>
              <CopyField id="hook-github" label="Payload URL" value={secrets.githubUrl} />
              <CopyField id="hook-secret" label="Secret" value={secrets.secret} />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Apps (bots)
// ---------------------------------------------------------------------------

function AppsSection({ ws }: { ws: WorkspaceDetail }) {
  const bots = useWorkspaceBots(ws.id);
  const { add, remove } = useWorkspaceBotMutations(ws.id);
  const me = useMe().data;
  const [adding, setAdding] = useState<WorkspaceBot | null>(null);
  const [removing, setRemoving] = useState<WorkspaceBot | null>(null);
  const added = (bots.data ?? []).filter((b) => b.inWorkspace);
  const available = (bots.data ?? []).filter((b) => !b.inWorkspace);

  return (
    <section className="grid gap-3" aria-labelledby="apps-heading">
      <div>
        <h2 id="apps-heading" className="flex items-center gap-2 text-base font-semibold">
          <BotIcon className="size-4" aria-hidden /> Apps
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Apps are bots the server owner has set up. Once added, an app is a member: give it roles to decide which channels it can read and post in.
          {me?.isServerOwner ? " You can create apps in Settings, under Server." : ""}
        </p>
      </div>
      {bots.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading apps" />
      ) : (bots.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">This server has no apps yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {[...added, ...available].map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <UserAvatar user={b} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {b.displayName} <span className="font-normal text-muted-foreground">@{b.username}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{[b.description, b.commands.length ? b.commands.map((c) => `/${c.name}`).join(" ") : null].filter(Boolean).join(" · ") || "No description"}</p>
              </div>
              {b.inWorkspace ? (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(b)}>
                  Remove
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setAdding(b)}>
                  <Plus className="size-4" aria-hidden /> Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {adding?.displayName} to {ws.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It can read every message in the channels it can see, and post where its roles allow. It starts with the @everyone role. Whoever runs the app receives what it reads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => adding && add.mutate(adding.id, { onSuccess: () => toast.success(`Added ${adding.displayName}`), onError: (err) => toast.error(errorMessage(err)) })}>Add app</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>It stops receiving messages from this workspace, and its commands go away here. Its old messages stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => removing && remove.mutate(removing.id, { onError: (err) => toast.error(errorMessage(err)) })}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const FEATURES: { id: GitHubFeature; label: string }[] = [
  { id: "issues", label: "Issues" },
  { id: "pulls", label: "Pull requests" },
  { id: "commits", label: "Commits" },
  { id: "releases", label: "Releases" },
  { id: "workflows", label: "Failed workflow runs" },
  { id: "reviews", label: "Reviews" },
  { id: "comments", label: "Comments" },
  { id: "branches", label: "Branches and tags" },
];
const DEFAULT_FEATURES: GitHubFeature[] = ["issues", "pulls", "commits", "releases", "workflows"];

function GitHubSection({ ws }: { ws: WorkspaceDetail }) {
  const status = useGitHubStatus();
  const subscriptions = useGitHubSubscriptions(ws.id, !!status.data?.configured);
  const { create, update, remove } = useGitHubSubscriptionMutations(ws.id);
  const [repo, setRepo] = useState("");
  const [channelId, setChannelId] = useState(textChannels(ws)[0]?.id ?? "");
  const [features, setFeatures] = useState<GitHubFeature[]>(DEFAULT_FEATURES);
  const me = useMe().data;
  const channelName = (id: string) => ws.channels.find((c) => c.id === id)?.name ?? "deleted-channel";
  const toggle = (list: GitHubFeature[], f: GitHubFeature) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!repo.trim() || !channelId || features.length === 0) return;
    create.mutate(
      { repo: repo.trim(), channelId, events: features },
      {
        onSuccess: (s) => {
          toast.success(`#${channelName(s.channelId)} now gets ${s.repo}'s activity`);
          setRepo("");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <section className="grid gap-3" aria-labelledby="github-heading">
      <div>
        <h2 id="github-heading" className="flex items-center gap-2 text-base font-semibold">
          <Github className="size-4" aria-hidden /> GitHub
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Post a repository's activity in a channel, with buttons to close and reopen issues. You can also type <code>/github subscribe owner/repo</code> in a channel.
        </p>
      </div>
      {status.isPending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading GitHub status" />
      ) : !status.data?.configured ? (
        <p className="text-sm text-muted-foreground">
          {me?.isServerOwner ? "Connect GitHub first, in Settings under Server." : "The server owner hasn't connected GitHub yet. Until then, a webhook's GitHub URL works for any repository."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {status.data.installations.length
              ? `The GitHub App is installed on ${status.data.installations.map((i) => i.account).join(", ")}. `
              : "The GitHub App isn't installed anywhere yet. "}
            {status.data.installUrl ? (
              <a href={status.data.installUrl} target="_blank" rel="noopener noreferrer" className="link">
                Install it on another account or organisation
              </a>
            ) : null}
          </p>
          {subscriptions.data?.length ? (
            <ul className="divide-y rounded-md border">
              {subscriptions.data.map((s) => (
                <li key={s.id} className="grid gap-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Github className="size-4 shrink-0" aria-hidden />
                    <a href={`https://github.com/${s.repo}`} target="_blank" rel="noopener noreferrer" className="link truncate text-sm font-medium">
                      {s.repo}
                    </a>
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Hash className="size-3" aria-hidden />
                      {channelName(s.channelId)}
                    </span>
                    <Button variant="ghost" size="icon" className="ml-auto" onClick={() => remove.mutate(s.id, { onError: (err) => toast.error(errorMessage(err)) })} aria-label={`Unsubscribe from ${s.repo}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {FEATURES.map((f) => (
                      <label key={f.id} className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={s.events.includes(f.id)}
                          onCheckedChange={() => {
                            const next = toggle(s.events, f.id);
                            if (next.length) update.mutate({ id: s.id, events: next }, { onError: (err) => toast.error(errorMessage(err)) });
                          }}
                        />
                        {f.label}
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <form onSubmit={submit} className="grid gap-3 rounded-md border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="gh-repo">Repository</Label>
                <Input id="gh-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gh-channel">Channel</Label>
                <ChannelSelect ws={ws} value={channelId} onChange={setChannelId} id="gh-channel" />
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
              <legend className="mb-1.5 text-sm font-medium">Post</legend>
              {FEATURES.map((f) => (
                <label key={f.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={features.includes(f.id)} onCheckedChange={() => setFeatures((list) => toggle(list, f.id))} />
                  {f.label}
                </label>
              ))}
            </fieldset>
            <div>
              <Button type="submit" size="sm" disabled={create.isPending || !repo.trim() || !channelId || features.length === 0}>
                {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Subscribe
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
