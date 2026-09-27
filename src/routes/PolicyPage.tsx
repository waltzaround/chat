import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";
import { apiGet } from "@/lib/api";
import type { ServerPolicies } from "@shared/types";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";

/**
 * /privacy and /terms: public, no sign-in. The owner's own text (Settings → Server), or
 * the built-in template. react-markdown never renders raw HTML.
 */
export function PolicyPage({ kind }: { kind: "privacy" | "terms" }) {
  const policies = useQuery({ queryKey: ["policies"], queryFn: () => apiGet<ServerPolicies>("/api/policies") });
  if (policies.isPending) return <FullscreenSpinner />;
  const text = kind === "privacy" ? policies.data?.privacyPolicy : policies.data?.terms;
  return (
    <main className="min-h-dvh bg-background px-4 py-12">
      <article className="mx-auto max-w-2xl text-sm leading-relaxed text-foreground [&_a]:link [&_h1]:mb-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_p]:text-muted-foreground [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground [&_strong]:text-foreground">
        {text ? <ReactMarkdown>{text}</ReactMarkdown> : <p>This server hasn't published this page.</p>}
        <p className="mt-10 border-t pt-4 text-xs">
          <Link to={kind === "privacy" ? "/terms" : "/privacy"} className="link">
            {kind === "privacy" ? "Terms of use" : "Privacy policy"}
          </Link>
          {" · "}
          <Link to="/" className="link">
            Back to Chat
          </Link>
        </p>
      </article>
    </main>
  );
}
