import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useAuthConfig } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8 rounded-md" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}

const backToSignIn = (
  <p className="mt-4 text-center text-xs text-muted-foreground">
    <Link className="text-primary hover:underline" to="/login">
      Back to sign in
    </Link>
  </p>
);

/**
 * "Forgot password?". With email set up (Workers Paid plan), sends a reset link.
 * Without it, explains that the server owner can make one.
 */
export function ForgotPasswordPage() {
  const config = useAuthConfig();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await authClient.requestPasswordReset({ email: email.trim() });
    setBusy(false);
    if (res.error) setError(res.error.status === 429 ? "Too many requests. Try again in an hour." : (res.error.message ?? "Could not send the email"));
    else setSent(true);
  };

  if (config.isPending) {
    return (
      <Card title="Reset your password">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </Card>
    );
  }

  if (!config.data?.passwordResetEmail) {
    return (
      <Card title="Reset your password">
        <div className="grid gap-3 text-sm text-muted-foreground">
          <p>This server doesn't send email, so ask the server owner for a reset link. They can make one for your account in User Settings → Server.</p>
          <p className="text-xs">Are you the owner? Run <code className="rounded bg-muted px-1 py-0.5">npm run recover</code> in the folder you set the server up from.</p>
        </div>
        {backToSignIn}
      </Card>
    );
  }

  if (sent) {
    return (
      <Card title="Check your email">
        <p className="text-sm text-muted-foreground">If an account uses {email.trim()}, it will get a link to choose a new password. The link works for an hour.</p>
        {backToSignIn}
      </Card>
    );
  }

  return (
    <Card title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Send reset link
        </Button>
      </form>
      {backToSignIn}
    </Card>
  );
}

/** Where emailed and owner-issued reset links land: /reset-password?token=… */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    const res = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setBusy(false);
    if (!res.error) setDone(true);
    else if (res.error.code === "INVALID_TOKEN") setError("This link has expired or was already used. Ask for a new one.");
    else setError(res.error.message ?? "Could not change your password");
  };

  if (!token) {
    return (
      <Card title="Reset your password">
        <p className="text-sm text-muted-foreground">This link is incomplete. Open the whole link you were sent, or ask for a new one.</p>
        {backToSignIn}
      </Card>
    );
  }

  if (done) {
    return (
      <Card title="Password changed">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          You're signed out everywhere else. Sign in with your new password.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card title="Choose a new password">
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
          <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} />
        </div>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <Button type="submit" disabled={busy || password.length < 8}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Change password
        </Button>
      </form>
      {backToSignIn}
    </Card>
  );
}
