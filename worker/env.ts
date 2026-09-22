/// <reference types="@cloudflare/workers-types/experimental" />
import type { WorkspaceHub } from "./durable-objects/workspace-hub";

export interface Env {
  // Bindings
  DB: D1Database;
  UPLOADS: R2Bucket;
  WORKSPACE_HUB: DurableObjectNamespace<WorkspaceHub>;
  BACKGROUND_QUEUE: Queue<BackgroundJob>;
  ANALYTICS?: AnalyticsEngineDataset;
  ASSETS: Fetcher;

  // Public vars
  APP_URL: string;
  TURNSTILE_SITE_KEY?: string;
  R2_BUCKET_NAME?: string;
  REALTIMEKIT_PRESET_FULL?: string;
  REALTIMEKIT_PRESET_LISTEN?: string;

  // Secrets
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  REALTIMEKIT_APP_ID?: string;
  CLOUDFLARE_REALTIME_API_TOKEN?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;

  // Test only
  TEST_MIGRATIONS?: unknown[];
}

export type BackgroundJob =
  | { type: "attachment.process"; attachmentId: string }
  | { type: "attachment.cleanup"; olderThanMs: number }
  | { type: "invites.expire" }
  | { type: "workspace.deleted"; workspaceId: string; r2Prefix: string }
  | { type: "message.deleted"; attachmentKeys: string[] };
