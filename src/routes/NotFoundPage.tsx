import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-rail p-4 text-center">
      <p className="text-5xl font-semibold tabular-nums text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold">This page does not exist</h1>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to Commons</Link>
      </Button>
    </main>
  );
}
