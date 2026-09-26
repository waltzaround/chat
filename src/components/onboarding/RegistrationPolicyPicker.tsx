import { Crown, Globe, Lock, Users } from "lucide-react";
import { toast } from "sonner";
import { useServerSettings, useUpdateServerSettings } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RegistrationPolicy, ServerSettings, WorkspaceCreationPolicy } from "@shared/types";

interface Option<V extends string> {
  value: V;
  title: string;
  description: string;
  icon: typeof Lock;
}

/** Server owner only: radio cards for one server setting. Saves on click. */
function ServerSettingPicker<K extends "registration" | "workspaceCreation">({ setting, label, options }: { setting: K; label: string; options: Option<ServerSettings[K]>[] }) {
  const settings = useServerSettings();
  const update = useUpdateServerSettings();
  const pending = update.isPending ? (update.variables as Partial<ServerSettings> | undefined)?.[setting] : undefined;
  const current = pending ?? settings.data?.[setting];

  const choose = (value: ServerSettings[K]) => {
    if (value === current) return;
    update.mutate({ [setting]: value }, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 text-left">
      {options.map(({ value, title, description, icon: Icon }) => {
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

const REGISTRATION: Option<RegistrationPolicy>[] = [
  { value: "invite", title: "Invite only", description: "People need an invite link to create an account.", icon: Lock },
  { value: "open", title: "Anyone with the URL", description: "Anyone who finds this server can create an account.", icon: Globe },
];

const WORKSPACE_CREATION: Option<WorkspaceCreationPolicy>[] = [
  { value: "everyone", title: "Everyone", description: "Anyone with an account can start their own workspace here.", icon: Users },
  { value: "owner", title: "Only me", description: "Members join your workspaces but cannot create new ones.", icon: Crown },
];

export function RegistrationPolicyPicker() {
  return <ServerSettingPicker setting="registration" label="Who can create an account" options={REGISTRATION} />;
}

export function WorkspaceCreationPicker() {
  return <ServerSettingPicker setting="workspaceCreation" label="Who can create workspaces" options={WORKSPACE_CREATION} />;
}
