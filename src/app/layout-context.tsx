import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useViewport } from "@/hooks/useMediaQuery";

interface LayoutState {
  viewport: "mobile" | "tablet" | "desktop";
  membersOpen: boolean;
  toggleMembers: () => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutState | null>(null);
const MEMBERS_KEY = "chat.membersOpen";

export function LayoutProvider({ children }: { children: ReactNode }) {
  const viewport = useViewport();
  const [membersPref, setMembersPref] = useState<boolean>(() => localStorage.getItem(MEMBERS_KEY) !== "false");
  const [membersOpenSmall, setMembersOpenSmall] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(MEMBERS_KEY, String(membersPref));
  }, [membersPref]);

  // Closing drawers when the viewport grows.
  useEffect(() => {
    if (viewport === "desktop") {
      setNavOpen(false);
      setMembersOpenSmall(false);
    }
  }, [viewport]);

  const membersOpen = viewport === "desktop" ? membersPref : membersOpenSmall;
  const toggleMembers = useCallback(() => {
    if (viewport === "desktop") setMembersPref((v) => !v);
    else setMembersOpenSmall((v) => !v);
  }, [viewport]);

  const value = useMemo<LayoutState>(
    () => ({ viewport, membersOpen, toggleMembers, navOpen, setNavOpen, searchOpen, setSearchOpen }),
    [viewport, membersOpen, toggleMembers, navOpen, searchOpen],
  );
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutState {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout outside LayoutProvider");
  return ctx;
}
