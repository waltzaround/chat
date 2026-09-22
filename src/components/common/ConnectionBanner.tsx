import { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useSocketStatus } from "@/realtime/hooks";
import { Button } from "@/components/ui/button";

/** Thin bar shown above the shell while the realtime connection is not open. */
export function ConnectionBanner() {
  const { status, attempt } = useSocketStatus();
  const rt = useRealtime();
  // Avoid flashing the banner on the very first connect.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === "open") {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), status === "connecting" ? 1500 : 400);
    return () => clearTimeout(t);
  }, [status]);
  if (!show || status === "open") return null;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="flex items-center justify-center gap-2 border-b bg-warning/15 px-3 py-1 text-xs text-foreground" role="status" aria-live="polite">
      {offline ? <WifiOff className="size-3.5" aria-hidden /> : <RefreshCw className="size-3.5 animate-spin" aria-hidden />}
      <span>
        {offline ? "You are offline." : status === "connecting" ? "Connecting…" : `Reconnecting${attempt > 1 ? ` (attempt ${attempt})` : ""}…`} Messages you send will be delivered when the connection returns.
      </span>
      {!offline ? (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => rt.reconnect()}>
          Retry now
        </Button>
      ) : null}
    </div>
  );
}
