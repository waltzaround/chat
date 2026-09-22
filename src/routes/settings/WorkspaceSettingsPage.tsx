import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Settings, Users, Shield, Hash, Link2, FileText, Trash2, Loader2,
  ChevronRight, Edit2, Plus, Folder,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { SettingsLayout } from "./SettingsLayout";
import { RoleEditor } from "./RoleEditor";
import { ChannelOverridesEditor } from "./ChannelOverridesEditor";
import { MembersTable } from "./MembersTable";
import { InvitesPanel } from "./InvitesPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { ImagePicker } from "@/components/common/ImagePicker";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateChannelDialog } from "@/components/channels/CreateChannelDialog";
import { EditChannelDialog } from "@/components/channels/EditChannelDialog";
import { CreateCategoryDialog } from "@/components/channels/CreateCategoryDialog";
import {
  useWorkspace,
  useMe,
  useMembers,
  useBans,
  useDeleteChannel,
  useDeleteCategory,
  useUpdateCategory,
  useUpdateWorkspace,
  useMemberMutations,
  keys,
} from "@/lib/queries";
import { apiDelete, errorMessage } from "@/lib/api";
import { can, Permission } from "@/lib/permissions";
import { formatFull } from "@/lib/format";
import type { Channel, WorkspaceDetail } from "@shared/types";

// ---------------------------------------------------------------------------
// Tab definitions (shown only if user has access)
// ---------------------------------------------------------------------------

interface TabDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  permissionBits: number;
  /** If true, check "any" of the bits rather than "all" */
  permissionAny?: boolean;
}

const ALL_TABS: TabDef[] = [
  { id: "overview", label: "Overview", icon: <Settings className="size-3.5" />, permissionBits: Permission.MANAGE_WORKSPACE },
  { id: "members", label: "Members", icon: <Users className="size-3.5" />, permissionBits: Permission.KICK_MEMBERS | Permission.BAN_MEMBERS | Permission.MANAGE_ROLES, permissionAny: true },
  { id: "roles", label: "Roles", icon: <Shield className="size-3.5" />, permissionBits: Permission.MANAGE_ROLES },
  { id: "channels", label: "Channels", icon: <Hash className="size-3.5" />, permissionBits: Permission.MANAGE_CHANNELS },
  { id: "invites", label: "Invites", icon: <Link2 className="size-3.5" />, permissionBits: Permission.CREATE_INVITES },
  { id: "audit", label: "Audit Log", icon: <FileText className="size-3.5" />, permissionBits: Permission.MANAGE_WORKSPACE },
];

function canAccessTab(ws: WorkspaceDetail, tab: TabDef): boolean {
  const bits = ws.myPermissions;
  // Admin pass-through
  if ((bits & Permission.ADMINISTRATOR) !== 0) return true;
  if (tab.permissionAny) return (bits & tab.permissionBits) !== 0;
  return (bits & tab.permissionBits) === tab.permissionBits;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function WorkspaceSettingsPage() {
  const { workspaceId, tab } = useParams<{ workspaceId: string; tab?: string }>();
  const { data: ws } = useWorkspace(workspaceId);
  const { data: me } = useMe();

  if (!workspaceId) return null;

  const visibleTabs = ws ? ALL_TABS.filter((t) => canAccessTab(ws, t)) : [];
  const activeTab = visibleTabs.find((t) => t.id === tab)?.id ?? visibleTabs[0]?.id ?? "";

  if (ws && visibleTabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">You don't have access to any workspace settings.</p>
      </div>
    );
  }

  return (
    <SettingsLayout
      tabs={visibleTabs}
      activeTab={activeTab}
      basePath={`/w/${workspaceId}/settings`}
      closePath={`/w/${workspaceId}`}
      title={ws?.name ?? "Workspace Settings"}
    >
      {ws && me && (
        <>
          {activeTab === "overview" && <OverviewTab ws={ws} meId={me.id} />}
          {activeTab === "members" && <MembersTab ws={ws} meId={me.id} />}
          {activeTab === "roles" && <RolesTab ws={ws} />}
          {activeTab === "channels" && <ChannelsTab ws={ws} />}
          {activeTab === "invites" && <InvitesTab ws={ws} />}
          {activeTab === "audit" && <AuditTab ws={ws} />}
        </>
      )}
    </SettingsLayout>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({ ws, meId }: { ws: WorkspaceDetail; meId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const updateWs = useUpdateWorkspace(ws.id);

  const [iconKey, setIconKey] = useState<string | null>(null);
  const [name, setName] = useState(ws.name);
  const [dirty, setDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateWs.mutateAsync({ name: name.trim(), ...(iconKey !== null ? { iconKey } : {}) });
      setDirty(false);
      toast.success("Workspace saved");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== ws.name) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/workspaces/${ws.id}`);
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      navigate("/");
    } catch (err) {
      toast.error(errorMessage(err));
      setDeleting(false);
    }
  };

  const isOwner = ws.ownerUserId === meId;

  return (
    <div className="grid gap-8">
      <form onSubmit={handleSave} className="grid gap-6">
        <h2 className="text-base font-semibold">Overview</h2>
        <div className="flex items-start gap-5">
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">Icon</Label>
            <ImagePicker
              purpose="workspace-icon"
              value={iconKey}
              onChange={(k) => { setIconKey(k); setDirty(true); }}
              label="Change workspace icon"
              fallbackText={ws.name}
              currentUrl={ws.iconUrl}
            />
          </div>
          <div className="flex-1 grid gap-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              maxLength={64}
              required
            />
          </div>
        </div>
        <div>
          <Button type="submit" disabled={!dirty || updateWs.isPending}>
            {updateWs.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>

      {isOwner && (
        <>
          <Separator />
          <div className="grid gap-3">
            <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
            <div className="rounded-md border border-destructive/40 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Delete this workspace</p>
                <p className="text-xs text-muted-foreground">Permanently remove this workspace and all its channels, messages and members.</p>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="shrink-0 gap-1.5">
                <Trash2 className="size-3.5" aria-hidden />
                Delete workspace
              </Button>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteConfirm(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{ws.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent and cannot be reversed. All channels, messages, roles, and members will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="delete-confirm">
              Type <strong>{ws.name}</strong> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={ws.name}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteConfirm !== ws.name || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Delete workspace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

function MembersTab({ ws, meId }: { ws: WorkspaceDetail; meId: string }) {
  const { data: bans = [] } = useBans(ws.id, can(ws, Permission.BAN_MEMBERS));
  const memberMuts = useMemberMutations(ws.id);

  return (
    <div className="grid gap-8">
      <div>
        <h2 className="mb-4 text-base font-semibold">Members</h2>
        <MembersTable ws={ws} meId={meId} />
      </div>

      {can(ws, Permission.BAN_MEMBERS) && (
        <>
          <Separator />
          <div>
            <h3 className="mb-3 text-sm font-semibold">Bans</h3>
            {bans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No bans.</p>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reason</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Banned by</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                      <th className="w-20 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {bans.map((ban, idx) => (
                      <tr key={ban.userId} className={idx % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {ban.user ? (
                              <UserAvatar user={{ id: ban.userId, displayName: ban.user.displayName, avatarUrl: ban.user.avatarUrl }} size="sm" />
                            ) : null}
                            <span className="text-sm">{ban.user?.displayName ?? ban.userId}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{ban.reason ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{ban.bannedBy?.displayName ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatFull(ban.createdAt)}</td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await memberMuts.unban.mutateAsync(ban.userId);
                                toast.success("Member unbanned");
                              } catch (err) {
                                toast.error(errorMessage(err));
                              }
                            }}
                            disabled={memberMuts.unban.isPending}
                          >
                            Unban
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles tab
// ---------------------------------------------------------------------------

function RolesTab({ ws }: { ws: WorkspaceDetail }) {
  return (
    <div className="grid gap-4">
      <h2 className="text-base font-semibold">Roles</h2>
      <RoleEditor workspaceId={ws.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channels tab
// ---------------------------------------------------------------------------

function ChannelsTab({ ws }: { ws: WorkspaceDetail }) {
  const { data: members = [] } = useMembers(ws.id);
  const deleteChannel = useDeleteChannel(ws.id);
  const deleteCategory = useDeleteCategory(ws.id);
  const updateCategory = useUpdateCategory(ws.id);

  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [overridesChannel, setOverridesChannel] = useState<Channel | null>(null);
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<Channel | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  const handleDeleteChannel = async (channelId: string) => {
    try {
      await deleteChannel.mutateAsync(channelId);
      toast.success("Channel deleted");
      setDeleteChannelTarget(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    try {
      await deleteCategory.mutateAsync(categoryId);
      toast.success("Category deleted");
      setDeleteCategoryId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleRenameCategory = async () => {
    if (!editCategoryId) return;
    try {
      await updateCategory.mutateAsync({ categoryId: editCategoryId, name: editCategoryName.trim() });
      toast.success("Category renamed");
      setEditCategoryId(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const uncategorized = ws.channels
    .filter((c) => !c.categoryId)
    .sort((a, b) => a.position - b.position);

  const categorized = [...ws.categories]
    .sort((a, b) => a.position - b.position)
    .map((cat) => ({
      category: cat,
      channels: ws.channels.filter((c) => c.categoryId === cat.id).sort((a, b) => a.position - b.position),
    }));

  const ChannelRow = ({ ch }: { ch: Channel }) => (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/20 group">
      <span className="text-muted-foreground text-xs" aria-hidden>{ch.kind === "text" ? "#" : "♫"}</span>
      <span className="flex-1 text-sm truncate">{ch.name}</span>
      <div className="hidden group-hover:flex items-center gap-1">
        <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`Edit ${ch.name}`} onClick={() => setEditChannel(ch)}>
          <Edit2 className="size-3" aria-hidden />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={`Permissions for ${ch.name}`} onClick={() => setOverridesChannel(ch)}>
          <Shield className="size-3" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6 text-destructive hover:text-destructive"
          aria-label={`Delete ${ch.name}`}
          onClick={() => setDeleteChannelTarget(ch)}
        >
          <Trash2 className="size-3" aria-hidden />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Channels</h2>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setCreateCategoryOpen(true)} className="gap-1.5">
            <Folder className="size-3.5" aria-hidden />
            New category
          </Button>
          <Button type="button" size="sm" onClick={() => setCreateChannelOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" aria-hidden />
            New channel
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border p-2 grid gap-0.5">
        {uncategorized.map((ch) => <ChannelRow key={ch.id} ch={ch} />)}

        {categorized.map(({ category, channels }) => (
          <div key={category.id} className="mt-1">
            <div className="flex items-center gap-1 px-2 py-1 group">
              <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
                {category.name}
              </span>
              <div className="hidden group-hover:flex items-center gap-0.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-5"
                  aria-label={`Rename category ${category.name}`}
                  onClick={() => { setEditCategoryId(category.id); setEditCategoryName(category.name); }}
                >
                  <Edit2 className="size-3" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-5 text-destructive hover:text-destructive"
                  aria-label={`Delete category ${category.name}`}
                  onClick={() => setDeleteCategoryId(category.id)}
                >
                  <Trash2 className="size-3" aria-hidden />
                </Button>
              </div>
            </div>
            <div className="pl-4">
              {channels.map((ch) => <ChannelRow key={ch.id} ch={ch} />)}
            </div>
          </div>
        ))}

        {ws.channels.length === 0 && ws.categories.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">No channels yet.</p>
        )}
      </div>

      <CreateChannelDialog
        workspaceId={ws.id}
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
        categoryId={null}
        categories={ws.categories}
        initialKind="text"
      />
      <CreateCategoryDialog workspaceId={ws.id} open={createCategoryOpen} onOpenChange={setCreateCategoryOpen} />

      {editChannel && (
        <EditChannelDialog
          workspaceId={ws.id}
          channel={editChannel}
          open
          onOpenChange={(o) => { if (!o) setEditChannel(null); }}
        />
      )}

      {overridesChannel && (
        <Dialog open onOpenChange={(o) => { if (!o) setOverridesChannel(null); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Permissions — #{overridesChannel.name}</DialogTitle>
              <DialogDescription>Override role permissions for this specific channel.</DialogDescription>
            </DialogHeader>
            <div className="py-2 max-h-96 overflow-y-auto">
              <ChannelOverridesEditor
                channelId={overridesChannel.id}
                workspaceId={ws.id}
                roles={ws.roles}
                members={members}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={!!deleteChannelTarget} onOpenChange={(o) => { if (!o) setDeleteChannelTarget(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete #{deleteChannelTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>All messages in this channel will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteChannelTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteChannelTarget && void handleDeleteChannel(deleteChannelTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteCategoryId} onOpenChange={(o) => { if (!o) setDeleteCategoryId(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>Channels in this category will become uncategorized.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteCategoryId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteCategoryId && void handleDeleteCategory(deleteCategoryId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editCategoryId} onOpenChange={(o) => { if (!o) setEditCategoryId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename category</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="cat-rename">Name</Label>
            <Input
              id="cat-rename"
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              maxLength={48}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditCategoryId(null)}>Cancel</Button>
            <Button
              type="button"
              onClick={() => void handleRenameCategory()}
              disabled={!editCategoryName.trim() || updateCategory.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invites tab
// ---------------------------------------------------------------------------

function InvitesTab({ ws }: { ws: WorkspaceDetail }) {
  return (
    <div className="grid gap-4">
      <h2 className="text-base font-semibold">Invites</h2>
      <InvitesPanel ws={ws} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit tab
// ---------------------------------------------------------------------------

function AuditTab({ ws }: { ws: WorkspaceDetail }) {
  return (
    <div className="grid gap-4">
      <h2 className="text-base font-semibold">Audit Log</h2>
      <AuditLogPanel workspaceId={ws.id} />
    </div>
  );
}
