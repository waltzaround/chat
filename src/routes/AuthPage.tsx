import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Lock, Mail } from "lucide-react";
import { authClient, type SocialProvider } from "@/lib/auth-client";
import { useAuthConfig, keys } from "@/lib/queries";
import { apiGet } from "@/lib/api";
import { hasClaimToken, hasInvite, rememberClaimToken } from "@/lib/signup-cookies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Turnstile } from "@/components/auth/Turnstile";
import { SetupSteps } from "@/components/onboarding/SetupSteps";

/** "Walter Lim" → "walterlim": a starting username people can still change. */
function usernameFrom(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "")
    .slice(0, 32);
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const config = useAuthConfig();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";

  // The setup link from `npm run setup` is /register?claim=…; keep the token for the sign-up request.
  const [hasClaim] = useState(() => {
    const claim = params.get("claim");
    if (claim) rememberClaimToken(claim);
    return hasClaimToken();
  });
  const [invited] = useState(hasInvite);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server wants the email confirmed before signing in.
  const [unverified, setUnverified] = useState<string | null>(null);
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
    await Promise.all([qc.invalidateQueries({ queryKey: keys.me }), qc.invalidateQueries({ queryKey: keys.authConfig })]);
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
        const res = await authClient.signUp.email({ email, password, name: displayName.trim() || username.trim(), username: username.trim().toLowerCase(), callbackURL: "/" }, { headers });
        if (res.error?.code === "email_not_verified") return setUnverified(email.trim());
        if (res.error) throw new Error(res.error.message ?? "Could not create your account");
      } else {
        const res = await authClient.signIn.email({ email, password }, { headers });
        if (res.error?.code === "email_not_verified") return setUnverified(email.trim());
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

  const onDisplayName = (value: string) => {
    setDisplayName(value);
    if (!usernameEdited) setUsername(usernameFrom(value));
  };

  const providers = config.data?.providers;
  const firstRun = config.data?.firstRun ?? false;
  const nextQuery = params.get("next") ? `?next=${encodeURIComponent(next)}` : "";
  // Invite-only servers accept new accounts only from people who opened an invite link.
  const canRegister = firstRun || config.data?.registration !== "invite" || invited;

  // A brand-new deployment has nobody to sign in as: go straight to creating the owner account.
  if (firstRun && mode === "login") return <Navigate to={`/register${nextQuery}`} replace />;

  const blocked =
    mode !== "register" ? null : firstRun && config.data?.claimRequired && !hasClaim ? "claim" : !canRegister ? "invite" : null;
  const owner = mode === "register" && firstRun && !blocked;
  const title = mode === "login" ? "Welcome back" : owner ? "Create your owner account" : blocked ? "Welcome" : "Create your account";
  const subtitle = owner ? "You are setting up this server. You can change its settings any time." : "Community chat on Cloudflare";
  const server = config.data?.server;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-rail p-4">
      {owner ? <SetupSteps current={0} /> : null}
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        {server?.name && !owner ? (
          <>
            <ServerBrandingCard name={server.name} description={server.description} iconUrl={server.iconUrl} />
            <h1 className="mb-4 text-sm text-muted-foreground">{mode === "login" ? "Log in to continue" : title}</h1>
          </>
        ) : (
          <div className="mb-6 flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-8 rounded-md" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">{title}</h1>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
        )}

        {unverified ? (
          <CheckEmail email={unverified} />
        ) : blocked ? (
          <SignUpClosed reason={blocked} />
        ) : (
          <>
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
                    <Label htmlFor="displayName">Your name</Label>
                    <Input id="displayName" value={displayName} onChange={(e) => onDisplayName(e.target.value)} autoComplete="name" maxLength={48} placeholder="Walter" autoFocus />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setUsernameEdited(true);
                      }}
                      autoComplete="username"
                      required
                      minLength={2}
                      maxLength={32}
                      placeholder="walter"
                      pattern="[a-z0-9_.]+"
                    />
                    <p className="text-[11px] text-muted-foreground">People mention you as @{username || "username"}. Lowercase letters, numbers, dots and underscores.</p>
                  </div>
                </>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={mode === "login"} />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "login" ? (
                    <Link to="/forgot-password" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                      Forgot password?
                    </Link>
                  ) : null}
                </div>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
                {mode === "register" ? <p className="text-[11px] text-muted-foreground">At least 8 characters.</p> : null}
                {mode === "register" && config.data?.requireVerifiedEmail && !owner ? (
                  <p className="text-[11px] text-muted-foreground">We'll email you a link to confirm your address before you can sign in.</p>
                ) : null}
              </div>
              {showTurnstile && siteKey ? <Turnstile siteKey={siteKey} onToken={onToken} className="mt-1" /> : null}
              {error ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="mt-1">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {mode === "login" ? "Sign in" : owner ? "Create owner account" : "Create account"}
              </Button>
            </form>
          </>
        )}

        {owner ? null : (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {mode === "login" ? (
              canRegister ? (
                <>
                  New here?{" "}
                  <Link className="text-primary hover:underline" to={`/register${nextQuery}`}>
                    Create an account
                  </Link>
                </>
              ) : (
                "New here? This server is invite-only: open an invite link from a member to join."
              )
            ) : (
              <>
                Already have an account?{" "}
                <Link className="text-primary hover:underline" to={`/login${nextQuery}`}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </main>
  );
}

function CheckEmail({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    await authClient.sendVerificationEmail({ email, callbackURL: "/" });
    setBusy(false);
    setSent(true);
  };
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Mail className="size-4 text-muted-foreground" aria-hidden />
        Check your email
      </div>
      <p className="text-muted-foreground">We sent a link to {email}. Open it to confirm your address, and you'll be signed in.</p>
      <Button type="button" variant="outline" onClick={() => void resend()} disabled={busy || sent}>
        {sent ? "Sent. Check your inbox" : "Send the link again"}
      </Button>
    </div>
  );
}

function SignUpClosed({ reason }: { reason: "claim" | "invite" }) {
  const Icon = reason === "claim" ? KeyRound : Lock;
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {reason === "claim" ? "This server is still being set up" : "This server is invite-only"}
      </div>
      <p className="text-muted-foreground">
        {reason === "claim"
          ? "The owner account is created from the setup link that npm run setup printed. If you set up this server, open that link."
          : "Ask a member for an invite link, then open it to create your account."}
      </p>
    </div>
  );
}

/** The server's own name, icon and description, set by its owner in Server settings. */
function ServerBrandingCard({ name, description, iconUrl }: { name: string; description: string | null; iconUrl: string | null }) {
  return (
    <div className="mb-5 flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
      {iconUrl ? (
        <img src={iconUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground" aria-hidden>
          {name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
        </span>
      )}
      <div className="min-w-0">
        <p className="font-semibold leading-tight">{name}</p>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        <p className="mt-0.5 text-xs text-muted-foreground/70">{window.location.host}</p>
      </div>
    </div>
  );
}
