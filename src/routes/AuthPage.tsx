import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { authClient, type SocialProvider } from "@/lib/auth-client";
import { useAuthConfig, keys } from "@/lib/queries";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Turnstile } from "@/components/auth/Turnstile";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const config = useAuthConfig();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [challengeRequired, setChallengeRequired] = useState(mode === "register");
  const onToken = useCallback((t: string | null) => setTurnstileToken(t), []);

  useEffect(() => {
    if (mode !== "login") return;
    void apiGet<{ turnstileRequired: boolean }>("/api/auth-challenge")
      .then((r) => setChallengeRequired(r.turnstileRequired))
      .catch(() => undefined);
  }, [mode]);

  const siteKey = config.data?.turnstileSiteKey ?? null;
  const showTurnstile = !!siteKey && challengeRequired;

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: keys.me });
    navigate(next, { replace: true });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (showTurnstile && !turnstileToken) {
      setError("Please complete the verification challenge.");
      return;
    }
    setBusy(true);
    try {
      const headers = turnstileToken ? { "x-turnstile-token": turnstileToken } : undefined;
      if (mode === "register") {
        const res = await authClient.signUp.email({ email, password, name: displayName.trim() || username.trim(), username: username.trim().toLowerCase() }, { headers });
        if (res.error) throw new Error(res.error.message ?? "Could not create your account");
      } else {
        const res = await authClient.signIn.email({ email, password }, { headers });
        if (res.error) {
          const r = await apiGet<{ turnstileRequired: boolean }>("/api/auth-challenge").catch(() => ({ turnstileRequired: false }));
          setChallengeRequired(r.turnstileRequired);
          setTurnstileToken(null);
          throw new Error(res.error.message ?? "Sign in failed");
        }
      }
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      if (window.turnstile) window.turnstile.reset();
      setTurnstileToken(null);
    } finally {
      setBusy(false);
    }
  };

  const social = async (provider: SocialProvider) => {
    setError(null);
    setBusy(true);
    try {
      await authClient.signIn.social({ provider, callbackURL: `${window.location.origin}${next}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign in");
      setBusy(false);
    }
  };

  const providers = config.data?.providers;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8 rounded-md" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
            <p className="text-xs text-muted-foreground">Commons — community chat</p>
          </div>
        </div>

        {providers && (providers.github || providers.google) ? (
          <div className="mb-4 grid gap-2">
            {providers.github ? (
              <Button type="button" variant="outline" onClick={() => social("github")} disabled={busy}>
                Continue with GitHub
              </Button>
            ) : null}
            {providers.google ? (
              <Button type="button" variant="outline" onClick={() => social("google")} disabled={busy}>
                Continue with Google
              </Button>
            ) : null}
            <div className="relative my-1 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              <span className="relative z-10 bg-card px-2">or</span>
              <span className="absolute inset-x-0 top-1/2 -z-0 border-t" aria-hidden />
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="grid gap-3" noValidate>
          {mode === "register" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" maxLength={48} placeholder="Walter" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={2} maxLength={32} placeholder="walter" pattern="[a-z0-9_.]+" />
                <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, dots and underscores.</p>
              </div>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
          </div>
          {showTurnstile && siteKey ? <Turnstile siteKey={siteKey} onToken={onToken} className="mt-1" /> : null}
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} className="mt-1">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link className="text-primary hover:underline" to={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link className="text-primary hover:underline" to={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}>
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
