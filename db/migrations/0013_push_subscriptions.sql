-- Web Push: one row per browser that turned on push. Pushes carry no payload; the
-- service worker fetches what's new, so only the endpoint is needed.
CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`origin` text NOT NULL,
	`muted_workspaces` text DEFAULT '[]' NOT NULL,
	`hide_text` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);
