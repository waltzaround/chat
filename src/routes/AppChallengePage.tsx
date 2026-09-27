import { useCallback } from "react";
import { Turnstile } from "@/components/auth/Turnstile";
import { useAuthConfig } from "@/lib/queries";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";

/**
 * Opened by the iOS and Android apps in a web view when this server's sign-up needs a
 * Turnstile check. Solving it navigates to chat://challenge?token=…, which the app
 * catches (the page never actually leaves) and sends with its sign-up request.
 */
export function AppChallengePage() {
  const config = useAuthConfig();
  const onToken = useCallback((token: string | null) => {
    if (token) window.location.href = `chat://challenge?token=${encodeURIComponent(token)}`;
  }, []);
  if (config.isPending) return <FullscreenSpinner />;
  const siteKey = config.data?.turnstileSiteKey;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="text-sm text-muted-foreground">{siteKey ? "One quick check that you're a person." : "No check needed. Go back to the app."}</p>
      {siteKey ? <Turnstile siteKey={siteKey} onToken={onToken} /> : null}
    </main>
  );
}
