import { cn } from "@/lib/utils";
import { hueFor, initials } from "@/lib/format";

const sizes = { sm: "size-6 text-[10px] rounded-md", md: "size-8 text-xs rounded-lg", lg: "size-12 text-base rounded-2xl", xl: "size-20 text-2xl rounded-3xl" } as const;

export function WorkspaceIcon({ workspace, size = "lg", className }: { workspace: { id: string; name: string; iconUrl: string | null }; size?: keyof typeof sizes; className?: string }) {
  if (workspace.iconUrl) {
    return <img src={workspace.iconUrl} alt="" className={cn(sizes[size], "shrink-0 object-cover", className)} />;
  }
  return (
    <span
      className={cn(sizes[size], "inline-flex shrink-0 items-center justify-center font-semibold text-white", className)}
      style={{ background: `oklch(0.5 0.12 ${hueFor(workspace.id)})` }}
      aria-hidden
    >
      {initials(workspace.name)}
    </span>
  );
}
