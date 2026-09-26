import type { ReactNode } from "react";
import { useParams } from "react-router";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { WorkspaceRail } from "@/components/workspace/WorkspaceRail";
import { ChannelSidebar } from "@/components/channels/ChannelSidebar";
import { MemberList } from "@/components/members/MemberList";
import { ConnectionBanner } from "@/components/common/ConnectionBanner";
import { VoiceTray } from "@/components/voice/VoiceTray";
import { SearchDialog } from "@/components/chat/SearchDialog";
import { useLayout } from "./layout-context";
import { useWorkspace } from "@/lib/queries";
import { DirectMessagesSidebar } from "@/components/dms/DirectMessagesSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { viewport, membersOpen, toggleMembers, navOpen, setNavOpen } = useLayout();
  const { workspaceId } = useParams();
  const isMobile = viewport === "mobile";
  // A direct message conversation shows your conversations instead of channels, and no member list.
  const isDm = useWorkspace(workspaceId).data?.kind === "dm";
  const sidebar = (onNavigate?: () => void) =>
    isDm ? <DirectMessagesSidebar activeWorkspaceId={workspaceId} onNavigate={onNavigate} /> : <ChannelSidebar onNavigate={onNavigate} />;

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        {isMobile ? (
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent side="left" className="flex w-[304px] flex-row gap-0 p-0 [&>button]:hidden" aria-describedby={undefined}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <WorkspaceRail />
              {sidebar(() => setNavOpen(false))}
            </SheetContent>
          </Sheet>
        ) : (
          <>
            <WorkspaceRail />
            {sidebar()}
          </>
        )}

        <main id="main" className="flex min-w-0 flex-1 flex-col bg-background">
          {children}
        </main>

        {membersOpen && workspaceId && !isDm ? (
          viewport === "desktop" ? (
            <MemberList workspaceId={workspaceId} />
          ) : (
            <Sheet open={membersOpen} onOpenChange={(o) => !o && toggleMembers()}>
              <SheetContent side="right" className="w-[260px] p-0 [&>button]:hidden" aria-describedby={undefined}>
                <SheetTitle className="sr-only">Members</SheetTitle>
                <MemberList workspaceId={workspaceId} />
              </SheetContent>
            </Sheet>
          )
        ) : null}
      </div>
      <VoiceTray />
      {workspaceId ? <SearchDialog workspaceId={workspaceId} /> : null}
    </div>
  );
}
