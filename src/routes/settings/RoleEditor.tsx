import { useState, useEffect, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRoles, useRoleMutations, useMembers } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { PERMISSION_NAMES, PERMISSION_LABELS, Permission } from "@shared/permissions";
import { cn } from "@/lib/utils";
import type { Role } from "@shared/types";

const PRESET_COLOURS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
  "#607d8b", "#795548", "#ff5722", "#00bcd4",
];

const GROUPS: Array<{ key: "general" | "text" | "voice"; label: string }> = [
  { key: "general", label: "General" },
  { key: "text", label: "Text" },
  { key: "voice", label: "Voice" },
];

interface RoleEditorProps {
  workspaceId: string;
}

export function RoleEditor({ workspaceId }: RoleEditorProps) {
  const { data: roles = [] } = useRoles(workspaceId);
  const { data: members = [] } = useMembers(workspaceId);
  const { create, update } = useRoleMutations(workspaceId);

  const sorted = [...roles].sort((a, b) => b.position - a.position);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.find((r) => r.id === selectedId) ?? sorted[0] ?? null;

  useEffect(() => {
    if (!selectedId && sorted.length) setSelectedId(sorted[0]!.id);
  }, [sorted.length]);

  const memberCountFor = (roleId: string) =>
    members.filter((m) => m.roleIds.includes(roleId)).length;

  const handleCreate = async () => {
    try {
      const role = await create.mutateAsync({ name: "New Role", permissions: 0 });
      setSelectedId(role.id);
      toast.success("Role created");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleMove = async (role: Role, dir: 1 | -1) => {
    try {
      await update.mutateAsync({ roleId: role.id, position: role.position + dir });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex gap-4 min-h-[500px]">
      {/* Role list */}
      <div className="w-48 shrink-0 flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleCreate()}
          disabled={create.isPending}
          className="mb-1 w-full justify-start gap-1.5 text-xs"
        >
          <Plus className="size-3.5" aria-hidden />
          New Role
        </Button>
        {sorted.map((role) => (
          <div
            key={role.id}
            className={cn(
              "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
              selected?.id === role.id && "bg-accent font-medium",
            )}
            onClick={() => setSelectedId(role.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setSelectedId(role.id)}
            aria-label={`Select role ${role.name}`}
          >
            <span
              className="size-2.5 shrink-0 rounded-full border border-border"
              style={role.colour ? { backgroundColor: role.colour } : {}}
              aria-hidden
            />
            <span className="flex-1 truncate text-xs">{role.name}</span>
            <span className="text-xs text-muted-foreground">{memberCountFor(role.id)}</span>
          </div>
        ))}
      </div>

      <Separator orientation="vertical" />

      {/* Editor */}
      <div className="flex-1">
        {selected ? (
          <RoleForm
            key={selected.id}
            role={selected}
            workspaceId={workspaceId}
            onMove={handleMove}
            onDelete={() => setSelectedId(sorted.find((r) => r.id !== selected.id)?.id ?? null)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Select a role to edit it.</p>
        )}
      </div>
    </div>
  );
}

function RoleForm({ role, workspaceId, onMove, onDelete }: { role: Role; workspaceId: string; onMove: (r: Role, d: 1 | -1) => void; onDelete: () => void }) {
  const { update, remove } = useRoleMutations(workspaceId);

  const [name, setName] = useState(role.name);
  const [colour, setColour] = useState<string | null>(role.colour);
  const [permissions, setPermissions] = useState(role.permissions);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(role.name);
    setColour(role.colour);
    setPermissions(role.permissions);
    setDirty(false);
  }, [role.id]);

  const togglePerm = (bit: number) => {
    setPermissions((p) => (p & bit ? p & ~bit : p | bit));
    setDirty(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ roleId: role.id, name: name.trim(), colour, permissions });
      setDirty(false);
      toast.success("Role saved");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(role.id);
      onDelete();
      toast.success("Role deleted");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const isAdmin = (permissions & Permission.ADMINISTRATOR) !== 0;

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{role.isDefault ? "@everyone" : role.name}</h3>
        <div className="flex items-center gap-1">
          {!role.isDefault && (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Move role up"
                onClick={() => onMove(role, 1)}
              >
                <ChevronUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Move role down"
                onClick={() => onMove(role, -1)}
              >
                <ChevronDown className="size-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>

      {!role.isDefault && (
        <div className="grid gap-1.5">
          <Label htmlFor={`role-name-${role.id}`}>Role name</Label>
          <Input
            id={`role-name-${role.id}`}
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            maxLength={48}
            required
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label>Colour</Label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => { setColour(null); setDirty(true); }}
            aria-label="No colour"
            className={cn(
              "size-6 rounded-full border-2 bg-muted",
              colour === null ? "border-primary" : "border-transparent hover:border-muted-foreground/40",
            )}
          />
          {PRESET_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setColour(c); setDirty(true); }}
              aria-label={`Colour ${c}`}
              className={cn(
                "size-6 rounded-full border-2",
                colour === c ? "border-primary" : "border-transparent hover:border-white/40",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="relative size-6">
            <input
              type="color"
              value={colour ?? "#5865f2"}
              onChange={(e) => { setColour(e.target.value); setDirty(true); }}
              className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0"
              aria-label="Custom colour"
            />
            <span
              className={cn(
                "block size-6 rounded-full border-2",
                colour && !PRESET_COLOURS.includes(colour) ? "border-primary" : "border-dashed border-muted-foreground/40",
              )}
              style={colour && !PRESET_COLOURS.includes(colour) ? { backgroundColor: colour } : {}}
              aria-hidden
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <Label>Permissions</Label>
        {isAdmin && (
          <p className="text-xs text-amber-500 dark:text-amber-400">Administrator grants every permission and bypasses channel overrides.</p>
        )}
        {GROUPS.map((group) => {
          const perms = PERMISSION_NAMES.filter((n) => PERMISSION_LABELS[n].group === group.key);
          return (
            <div key={group.key}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <div className="grid gap-2">
                {perms.map((name) => {
                  const bit = Permission[name];
                  const { label, description } = PERMISSION_LABELS[name];
                  const checked = (permissions & bit) !== 0;
                  return (
                    <div key={name} className="flex items-center justify-between gap-4 py-1">
                      <div>
                        <p className="text-sm">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={() => togglePerm(bit)}
                        aria-label={label}
                        id={`perm-${role.id}-${name}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button type="submit" size="sm" disabled={!dirty || update.isPending}>
          {update.isPending ? <><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</> : "Save role"}
        </Button>
        {!role.isDefault && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="destructive" className="ml-auto gap-1.5">
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete role "{role.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This role will be removed from all members. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  );
}
