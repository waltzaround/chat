import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Your account", "Workspace", "Invite people"];

/** Progress for the server owner's first-run setup. `current` is 0-based. */
export function SetupSteps({ current, className }: { current: number; className?: string }) {
  return (
    <ol className={cn("flex items-center justify-center gap-2 text-[11px] text-muted-foreground", className)} aria-label="Server setup">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-2" aria-current={index === current ? "step" : undefined}>
          {index > 0 ? <span className="h-px w-4 bg-border" aria-hidden /> : null}
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-[10px] font-medium",
              index < current && "border-primary bg-primary text-primary-foreground",
              index === current && "border-primary text-primary",
            )}
            aria-hidden
          >
            {index < current ? <Check className="size-3" /> : index + 1}
          </span>
          <span className={cn(index === current && "font-medium text-foreground")}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
