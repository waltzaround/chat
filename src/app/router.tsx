import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { RequireAuth } from "./RequireAuth";
import { AuthPage } from "@/routes/AuthPage";
import { InvitePage } from "@/routes/InvitePage";
import { ForgotPasswordPage, ResetPasswordPage } from "@/routes/PasswordPages";
import { RootRedirect } from "@/routes/RootRedirect";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { WorkspaceLayout } from "@/app/WorkspaceLayout";
import { ChannelRoute } from "@/routes/ChannelRoute";
import { WorkspaceIndexRoute } from "@/routes/WorkspaceIndexRoute";
import { NoWorkspacePage } from "@/routes/NoWorkspacePage";
import { DirectMessagesPage } from "@/routes/DirectMessagesPage";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";

const UserSettingsPage = lazy(() => import("@/routes/settings/UserSettingsPage").then((m) => ({ default: m.UserSettingsPage })));
const WorkspaceSettingsPage = lazy(() => import("@/routes/settings/WorkspaceSettingsPage").then((m) => ({ default: m.WorkspaceSettingsPage })));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<FullscreenSpinner />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/register", element: <AuthPage mode="register" /> },
  { path: "/invite/:code", element: <InvitePage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <RootRedirect /> },
      { path: "/welcome", element: <NoWorkspacePage /> },
      { path: "/dms", element: <DirectMessagesPage /> },
      {
        path: "/settings/:tab?",
        element: (
          <Lazy>
            <UserSettingsPage />
          </Lazy>
        ),
      },
      {
        path: "/w/:workspaceId",
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <WorkspaceIndexRoute /> },
          { path: "c/:channelId", element: <ChannelRoute /> },
          {
            path: "settings/:tab?",
            element: (
              <Lazy>
                <WorkspaceSettingsPage />
              </Lazy>
            ),
          },
          { path: "*", element: <Navigate to="." replace /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
