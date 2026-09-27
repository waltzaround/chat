import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { approveBrowserLink, completeBrowserLink, linkedKeys, normalizeOrigin } from "@/lib/linked-servers";

function Card({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="grid w-full max-w-sm gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">{icon}</div>
        {children}
      </div>
    </main>
  );
}

/**
 * Reached from another Chat server's "Add a server". Asks before giving that server a
 * linked session (it then links back, so each shows the other).
 */
export function LinkPage() {
  const [params] = useSearchParams();
  const me = useMe().data;
  const from = normalizeOrigin(params.get("from") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const here = window.location.host;

  if (!from || from === window.location.origin) {
    return (
      <Card icon={<Link2 className="size-6" aria-hidden />}>
        <div className="grid gap-2">
          <h1 className="text-lg font-semibold">Nothing to link</h1>
          <p className="text-sm text-muted-foreground">Start from “Add a server” on your other Chat server.</p>
        </div>
      </Card>
    );
  }
  const there = new URL(from).host;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveBrowserLink(from);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card icon={<Link2 className="size-6" aria-hidden />}>
      <div className="grid gap-2">
        <h1 className="text-lg font-semibold">
          Show {here} on {there}?
        </h1>
        <p className="text-sm text-muted-foreground">
          You're signed in here as <strong className="text-foreground">{me?.displayName ?? "…"}</strong>. {there} will see your workspaces, conversations and unread counts on {here}. This server will show {there} too.
        </p>
        <p className="text-sm text-muted-foreground">Neither can read or send messages on the other. Remove the link any time in Settings.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => window.location.assign(from)}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void approve()} disabled={busy || !me}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Link servers
        </Button>
      </div>
    </Card>
  );
}

/** Where the linking redirects land (see completeBrowserLink). */
export function LinkCompletePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState<{ error?: string; linked?: string }>({});

  useEffect(() => {
    const hash = window.location.hash;
    // Keep the token out of history.
    window.history.replaceState(null, "", "/link/complete");
    const done = normalizeOrigin(new URLSearchParams(hash.replace(/^#/, "")).get("done") ?? "");
    completeBrowserLink(hash)
      .then(async (server) => {
        await qc.invalidateQueries({ queryKey: linkedKeys.all });
        // The last hop sends you back where you started.
        if (done && done === server) return window.location.assign(`${done}/?linked=${encodeURIComponent(window.location.host)}`);
        setState({ linked: new URL(server).host });
        window.setTimeout(() => navigate("/", { replace: true }), 1500);
      })
      .catch((err: unknown) => setState({ error: errorMessage(err) }));
  }, [navigate, qc]);

  return (
    <Card icon={state.error ? <Link2 className="size-6" aria-hidden /> : state.linked ? <Check className="size-6" aria-hidden /> : <Loader2 className="size-6 animate-spin" aria-hidden />}>
      <div className="grid gap-2">
        <h1 className="text-lg font-semibold">{state.error ? "Couldn't link" : state.linked ? `${state.linked} added` : "Linking…"}</h1>
        {state.error ? <p className="text-sm text-muted-foreground">{state.error}</p> : null}
        {state.error ? (
          <div>
            <Button type="button" onClick={() => navigate("/", { replace: true })}>
              Back to Chat
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
