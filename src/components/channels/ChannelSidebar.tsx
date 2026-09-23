import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronDown, ChevronRight, FolderPlus, GripVertical, Hash, LogOut, Pencil, Plus, Settings, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useWorkspace, useMembers, useMemberMutations, useReorderLayout, useUpdateCategory } from "@/lib/queries";
import { Permission, can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelItem } from "./ChannelItem";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { CreateCategoryDialog } from "./CreateCategoryDialog";
import { InviteDialog } from "@/components/workspace/InviteDialog";
import { UserPanel } from "./UserPanel";
import type { Category, Channel, WorkspaceDetail } from "@shared/types";
import { errorMessage } from "@/lib/api";
import { useVoice } from "@/components/voice/VoiceProvider";

/** Local, draggable representation of the sidebar layout. */
interface Layout {
  /** Section ids in order; NONE is the pseudo-section for uncategorised channels. */
  sections: string[];
  /** Channel ids per section id. */
  channels: Record<string, string[]>;
}
const NONE = "__none__";
const secKey = (id: string) => `sec:${id}`;
const chKey = (id: string) => `ch:${id}`;
const unKey = (key: string) => key.slice(key.indexOf(":") + 1);

function layoutFrom(ws: WorkspaceDetail): Layout {
  const sections = [...ws.categories].sort((a, b) => a.position - b.position).map((c) => c.id);
  const validSection = new Set(sections);
  const channels: Record<string, string[]> = { [NONE]: [] };
  for (const s of sections) channels[s] = [];
  for (const ch of [...ws.channels].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
    const key = ch.categoryId && validSection.has(ch.categoryId) ? ch.categoryId : NONE;
    channels[key]!.push(ch.id);
  }
  return { sections, channels };
}

function sameLayout(a: Layout, b: Layout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ChannelSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { workspaceId, channelId } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const memberActions = useMemberMutations(workspaceId ?? "");
  const reorder = useReorderLayout(workspaceId ?? "");
  const voice = useVoice();
  const [collapsed, setCollapsed] = useLocalStorage<Record<string, boolean>>(`chat.collapsed.${workspaceId}`, {});
  const [createChannel, setCreateChannel] = useState<{ open: boolean; categoryId: string | null; kind: "text" | "voice" }>({ open: false, categoryId: null, kind: "text" });
  const [createCategory, setCreateCategory] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const ws = workspace.data;
  const canManage = can(ws, Permission.MANAGE_CHANNELS);
  const canOrganise = canManage || can(ws, Permission.MANAGE_LAYOUT);
  const canInvite = can(ws, Permission.CREATE_INVITES);
  const canSettings = can(ws, Permission.MANAGE_WORKSPACE) || can(ws, Permission.MANAGE_ROLES) || can(ws, Permission.MANAGE_CHANNELS) || can(ws, Permission.BAN_MEMBERS) || can(ws, Permission.MANAGE_EMOJIS);

  // Server layout → local draggable layout. Local edits win while a drag is in flight.
  const serverLayout = useMemo(() => (ws ? layoutFrom(ws) : null), [ws]);
  const [layout, setLayout] = useState<Layout | null>(serverLayout);
  const [dragging, setDragging] = useState<string | null>(null);
  useEffect(() => {
    if (!dragging && serverLayout) setLayout(serverLayout);
  }, [serverLayout, dragging]);

  const channelById = useMemo(() => new Map((ws?.channels ?? []).map((c) => [c.id, c])), [ws]);
  const categoryById = useMemo(() => new Map((ws?.categories ?? []).map((c) => [c.id, c])), [ws]);
  const membersById = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m])), [members.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findSectionOf = useCallback(
    (key: string, l: Layout): string | null => {
      if (key.startsWith("sec:")) return unKey(key);
      const id = unKey(key);
      for (const [section, ids] of Object.entries(l.channels)) if (ids.includes(id)) return section;
      return null;
    },
    [],
  );

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));

  /** Move a channel between sections while hovering so the list previews the drop. */
  const onDragOver = (e: DragOverEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!layout || !over || !active.startsWith("ch:")) return;
    const from = findSectionOf(active, layout);
    const to = over.startsWith("sec:") ? unKey(over) : findSectionOf(over, layout);
    if (!from || !to || from === to) return;
    setLayout((l) => {
      if (!l) return l;
      const id = unKey(active);
      const fromList = l.channels[from]!.filter((x) => x !== id);
      const toList = [...(l.channels[to] ?? [])];
      const overIndex = over.startsWith("ch:") ? toList.indexOf(unKey(over)) : toList.length;
      toList.splice(overIndex < 0 ? toList.length : overIndex, 0, id);
      return { ...l, channels: { ...l.channels, [from]: fromList, [to]: toList } };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    setDragging(null);
    if (!layout || !serverLayout) return;
    let next = layout;
    if (active.startsWith("sec:") && over?.startsWith("sec:") && active !== over) {
      const ids = layout.sections;
      const from = ids.indexOf(unKey(active));
      const to = ids.indexOf(unKey(over));
      if (from >= 0 && to >= 0) next = { ...layout, sections: arrayMove(ids, from, to) };
    } else if (active.startsWith("ch:") && over) {
      const section = findSectionOf(active, layout);
      if (section) {
        const list = layout.channels[section] ?? [];
        const from = list.indexOf(unKey(active));
        const to = over.startsWith("ch:") ? list.indexOf(unKey(over)) : list.length - 1;
        if (from >= 0 && to >= 0 && from !== to) next = { ...layout, channels: { ...layout.channels, [section]: arrayMove(list, from, to) } };
      }
    }
    setLayout(next);
    if (sameLayout(next, serverLayout)) return;
    // Persist: sequential positions for sections; channels numbered globally in display order.
    const categories = next.sections.map((id, position) => ({ id, position }));
    const channels: { id: string; position: number; categoryId: string | null }[] = [];
    let pos = 0;
    for (const section of [NONE, ...next.sections]) for (const id of next.channels[section] ?? []) channels.push({ id, position: pos++, categoryId: section === NONE ? null : section });
    reorder.mutate({ categories, channels }, { onError: (err) => toast.error(errorMessage(err, "Could not save the new order")) });
  };

  const onDragCancel = () => {
    setDragging(null);
    if (serverLayout) setLayout(serverLayout);
  };

  // Channels should drop onto channels (closest centre) but sections should snap to section headers.
  const collision: CollisionDetection = useCallback((args) => {
    const id = String(args.active.id);
    if (id.startsWith("sec:")) return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith("sec:")) });
    const within = pointerWithin(args);
    const candidates = within.length ? within : rectIntersection(args);
    return candidates.length ? candidates : closestCenter(args);
  }, []);

  const onChannelClick = (ch: Channel) => {
    if (ch.kind === "voice" && voice.connectedChannelId !== ch.id) void voice.join(ch.id);
    navigate(`/w/${workspaceId}/c/${ch.id}`);
    onNavigate?.();
  };

  const leave = async () => {
    if (!ws) return;
    if (!confirm(`Leave ${ws.name}?`)) return;
    try {
      await memberActions.leave.mutateAsync();
      navigate("/");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const activeChannel = dragging?.startsWith("ch:") ? channelById.get(unKey(dragging)) : undefined;
  const activeSection = dragging?.startsWith("sec:") ? categoryById.get(unKey(dragging)) : undefined;

  return (
    <aside aria-label="Channels" className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-12 w-full items-center justify-between border-b border-sidebar-border px-4 text-left font-semibold text-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            aria-label={ws ? `${ws.name} — workspace menu` : "Workspace menu"}
          >
            {ws ? <span className="truncate">{ws.name}</span> : <Skeleton className="h-4 w-28" />}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {canInvite ? (
            <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
              <UserPlus /> Invite people
            </DropdownMenuItem>
          ) : null}
          {canSettings ? (
            <DropdownMenuItem onSelect={() => navigate(`/w/${workspaceId}/settings`)}>
              <Settings /> Workspace settings
            </DropdownMenuItem>
          ) : null}
          {canManage || canOrganise ? <DropdownMenuSeparator /> : null}
          {canManage ? (
            <DropdownMenuItem onSelect={() => setCreateChannel({ open: true, categoryId: null, kind: "text" })}>
              <Plus /> Create channel
            </DropdownMenuItem>
          ) : null}
          {canOrganise ? (
            <DropdownMenuItem onSelect={() => setCreateCategory(true)}>
              <FolderPlus /> Create section
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={leave} disabled={!ws}>
            <LogOut /> Leave workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Channel list">
        {workspace.isPending || !layout || !ws ? (
          <div className="space-y-2 px-2 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel} modifiers={[restrictToVerticalAxis]}>
            <SectionGroup
              sectionId={NONE}
              category={null}
              channelIds={layout.channels[NONE] ?? []}
              collapsed={false}
              onToggle={() => undefined}
              canManage={canManage}
              canOrganise={canOrganise}
              workspaceId={workspaceId!}
              ws={ws}
              channelById={channelById}
              membersById={membersById}
              activeChannelId={channelId}
              onChannelClick={onChannelClick}
              onCreateChannel={() => setCreateChannel({ open: true, categoryId: null, kind: "text" })}
            />
            <SortableContext items={layout.sections.map(secKey)} strategy={verticalListSortingStrategy}>
              {layout.sections.map((sectionId) => (
                <SectionGroup
                  key={sectionId}
                  sectionId={sectionId}
                  category={categoryById.get(sectionId) ?? null}
                  channelIds={layout.channels[sectionId] ?? []}
                  collapsed={!!collapsed[sectionId]}
                  onToggle={() => setCollapsed((c) => ({ ...c, [sectionId]: !c[sectionId] }))}
                  canManage={canManage}
                  canOrganise={canOrganise}
                  workspaceId={workspaceId!}
                  ws={ws}
                  channelById={channelById}
                  membersById={membersById}
                  activeChannelId={channelId}
                  onChannelClick={onChannelClick}
                  onCreateChannel={() => setCreateChannel({ open: true, categoryId: sectionId, kind: "text" })}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeChannel ? (
                <div className="flex h-8 items-center gap-1.5 rounded-md border bg-popover px-2 text-[0.92rem] shadow-lg">
                  <Hash className="size-4 text-muted-foreground" aria-hidden />
                  <span className="truncate">{activeChannel.name}</span>
                </div>
              ) : activeSection ? (
                <div className="rounded-md border bg-popover px-2 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-lg">{activeSection.name}</div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        {ws && ws.channels.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <Hash className="mx-auto mb-2 size-5 opacity-50" aria-hidden />
            {canManage ? "Create your first channel from the workspace menu." : "There are no channels you can see yet."}
          </div>
        ) : null}
        {ws && canOrganise ? (
          <button
            type="button"
            onClick={() => setCreateCategory(true)}
            className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FolderPlus className="size-3.5" aria-hidden /> New section
          </button>
        ) : null}
      </nav>

      <UserPanel />

      {workspaceId ? (
        <>
          <CreateChannelDialog
            workspaceId={workspaceId}
            open={createChannel.open}
            categoryId={createChannel.categoryId}
            initialKind={createChannel.kind}
            categories={ws?.categories ?? []}
            onOpenChange={(open) => setCreateChannel((s) => ({ ...s, open }))}
          />
          <CreateCategoryDialog workspaceId={workspaceId} open={createCategory} onOpenChange={setCreateCategory} />
          {ws ? <InviteDialog workspace={ws} open={inviteOpen} onOpenChange={setInviteOpen} /> : null}
        </>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionGroup({
  sectionId,
  category,
  channelIds,
  collapsed,
  onToggle,
  canManage,
  canOrganise,
  workspaceId,
  ws,
  channelById,
  membersById,
  activeChannelId,
  onChannelClick,
  onCreateChannel,
}: {
  sectionId: string;
  category: Category | null;
  channelIds: string[];
  collapsed: boolean;
  onToggle: () => void;
  canManage: boolean;
  canOrganise: boolean;
  workspaceId: string;
  ws: WorkspaceDetail;
  channelById: Map<string, Channel>;
  membersById: Map<string, import("@shared/types").Member>;
  activeChannelId: string | undefined;
  onChannelClick: (ch: Channel) => void;
  onCreateChannel: () => void;
}) {
  const isNone = sectionId === NONE;
  const sortable = useSortable({ id: secKey(sectionId), disabled: isNone || !canOrganise, data: { type: "section" } });
  const droppable = useDroppable({ id: secKey(sectionId), disabled: !canOrganise });
  const update = useUpdateCategory(workspaceId);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(category?.name ?? "");

  const commitRename = async () => {
    const name = draft.trim();
    setRenaming(false);
    if (!category || !name || name === category.name) return;
    try {
      await update.mutateAsync({ categoryId: category.id, name });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (isNone && channelIds.length === 0) {
    // Keep an (invisible) drop target so channels can be dragged out of every section.
    return <div ref={droppable.setNodeRef} className={cn("h-1 rounded", droppable.isOver && "h-8 border border-dashed border-primary/50")} aria-hidden />;
  }

  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  return (
    <section ref={sortable.setNodeRef} style={style} className={cn("mb-3", sortable.isDragging && "opacity-40")} aria-label={category?.name ?? "Channels"}>
      {category ? (
        <div className="group flex items-center gap-0.5 pt-2 pr-1">
          {canOrganise ? (
            <button
              type="button"
              aria-label={`Drag to reorder section ${category.name}`}
              className="flex size-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
              {...sortable.attributes}
              {...sortable.listeners}
            >
              <GripVertical className="size-3" aria-hidden />
            </button>
          ) : (
            <span className="size-4 shrink-0" aria-hidden />
          )}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") {
                  setDraft(category.name);
                  setRenaming(false);
                }
              }}
              maxLength={48}
              aria-label="Section name"
              className="h-5 min-w-0 flex-1 rounded border bg-background px-1 text-[11px] font-semibold uppercase tracking-wide outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              className="flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {collapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
              <span className="truncate">{category.name}</span>
            </button>
          )}
          {canOrganise && !renaming ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Rename section ${category.name}`}
                  onClick={() => {
                    setDraft(category.name);
                    setRenaming(true);
                  }}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Pencil className="size-3" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Rename section</TooltipContent>
            </Tooltip>
          ) : null}
          {canManage ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Create channel in ${category.name}`}
                  onClick={onCreateChannel}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Create channel</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
      <div ref={droppable.setNodeRef} className={cn("rounded-md transition-colors", droppable.isOver && canOrganise && "bg-primary/5 ring-1 ring-primary/30")}>
        <SortableContext items={channelIds.map(chKey)} strategy={verticalListSortingStrategy}>
          <ul className={cn("mt-0.5 min-h-2 space-y-px", collapsed && "hidden")}>
            {channelIds.map((id) => {
              const ch = channelById.get(id);
              if (!ch) return null;
              return (
                <SortableChannel key={id} id={id} disabled={!canOrganise}>
                  <ChannelItem channel={ch} active={ch.id === activeChannelId} canManage={canManage} workspaceId={workspaceId} membersById={membersById} roles={ws.roles} onClick={() => onChannelClick(ch)} />
                </SortableChannel>
              );
            })}
            {!collapsed && channelIds.length === 0 && category ? <li className="px-2 py-1 text-xs text-muted-foreground/70">{canOrganise ? "Drag channels here" : "No channels"}</li> : null}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

function SortableChannel({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const sortable = useSortable({ id: chKey(id), disabled, data: { type: "channel" } });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  // Pointer drag works on the whole row; the ARIA/keyboard affordance lives on a grip handle so the
  // row itself is not announced as a second button.
  return (
    <div ref={sortable.setNodeRef} style={style} className={cn("group/row relative", sortable.isDragging && "opacity-40")} {...(disabled ? {} : sortable.listeners)} data-sortable-channel={id}>
      {!disabled ? (
        <button
          type="button"
          aria-label="Drag to reorder channel"
          className="absolute top-1/2 -left-1 z-10 flex size-4 -translate-y-1/2 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical className="size-3" aria-hidden />
        </button>
      ) : null}
      {children}
    </div>
  );
}
