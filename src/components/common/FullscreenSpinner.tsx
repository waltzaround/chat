import { Loader2 } from "lucide-react";

export function FullscreenSpinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-dvh w-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      {label ? <p className="text-sm">{label}</p> : <span className="sr-only">Loading</span>}
    </div>
  );
}
