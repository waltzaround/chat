import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title,
  description,
  onRetry,
  action,
  fullscreen,
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  action?: ReactNode;
  fullscreen?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col items-center justify-center gap-3 p-8 text-center", fullscreen ? "min-h-dvh bg-background" : "h-full", className)} role="alert">
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
