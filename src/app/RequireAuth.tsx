import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useMe } from "@/lib/queries";
import { isApiError } from "@/lib/api";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { UserNotifications } from "@/realtime/UserNotifications";

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <FullscreenSpinner label="Signing you in…" />;
  if (me.isError) {
    if (isApiError(me.error) && me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      return <Navigate to={`/login?next=${next}`} replace />;
    }
    return <ErrorState title="Could not load your account" description="Check your connection and try again." onRetry={() => void me.refetch()} fullscreen />;
  }
  return (
    <>
      <UserNotifications />
      {children}
    </>
  );
}
