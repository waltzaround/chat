import { Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { useServerSettings, useUpdateServerSettings } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RegistrationPolicy } from "@shared/types";

const OPTIONS: Array<{ value: RegistrationPolicy; title: string; description: string; icon: typeof Lock }> = [
  { value: "invite", title: "Invite only", description: "People need an invite link to create an account.", icon: Lock },
  { value: "open", title: "Anyone with the URL", description: "Anyone who finds this server can create an account.", icon: Globe },
];

/** Server owner only: who can create an account on this server. Saves on click. */
export function RegistrationPolicyPicker() {
  const settings = useServerSettings();
  const update = useUpdateServerSettings();
  const current = update.isPending ? update.variables?.registration : settings.data?.registration;

  const choose = (registration: RegistrationPolicy) => {
    if (registration === current) return;
    update.mutate({ registration }, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <div role="radiogroup" aria-label="Who can create an account" className="grid gap-2 text-left">
      {OPTIONS.map(({ value, title, description, icon: Icon }) => {
        const selected = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={settings.isPending}
            onClick={() => choose(value)}
            className={cn(
              "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-accent/50 disabled:opacity-50",
              selected && "border-primary bg-primary/5",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", selected && "text-primary")} aria-hidden />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
