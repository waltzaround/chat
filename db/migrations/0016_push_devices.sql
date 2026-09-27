-- Phones (the iOS and Android apps). Pushes go through a push relay run by whoever
-- publishes the apps: it holds the Apple/Firebase keys, and this server only holds
-- an opaque push key the relay issued. Pushes carry no message text; the app asks
-- /api/push/pending what to show. Signing out (deleting the session) removes the row.
CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`platform` text NOT NULL,
	`relay` text NOT NULL,
	`push_key` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_key_idx` ON `push_devices` (`push_key`);
--> statement-breakpoint
CREATE INDEX `push_devices_user_idx` ON `push_devices` (`user_id`);
