import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { router } from "@/app/router";
import { isApiError } from "@/lib/api";
import "@fontsource-variable/public-sans";
import "@/styles/globals.css";
import { registerServiceWorker } from "@/lib/push";
import { isDesktopApp, openExternalLinksInBrowser } from "@/lib/desktop";

// The desktop app has its own notifications and runs in the background, so it
// doesn't need the service worker (installing, Web Push).
if (isDesktopApp()) openExternalLinksInBrowser();
else registerServiceWorker();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" theme="system" richColors closeButton toastOptions={{ className: "text-sm" }} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
