import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SettingsTab {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface SettingsLayoutProps {
  tabs: SettingsTab[];
  activeTab: string;
  basePath: string;
  closePath: string;
  title: string;
  bottomContent?: ReactNode;
  children: ReactNode;
}

export function SettingsLayout({ tabs, activeTab, basePath, closePath, title, bottomContent, children }: SettingsLayoutProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") void navigate(closePath);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, closePath]);

  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      {/* Left nav */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-4 pt-5 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-1" aria-label="Settings navigation">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => void navigate(`${basePath}/${tab.id}`, { replace: true })}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                activeTab === tab.id && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
              )}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.icon ? <span className="text-muted-foreground" aria-hidden>{tab.icon}</span> : null}
              {tab.label}
            </button>
          ))}
        </nav>
        {bottomContent ? <div className="border-t border-border px-2 py-3">{bottomContent}</div> : null}
      </aside>

      {/* Right content */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close settings (Escape)"
          onClick={() => void navigate(closePath)}
          className="absolute top-4 right-4 z-10 size-8 rounded-full"
        >
          <X className="size-4" aria-hidden />
        </Button>
        <ScrollArea className="flex-1">
          <main className="mx-auto max-w-3xl px-8 py-8 pb-16">
            {children}
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}
