import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center", className)}>
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
