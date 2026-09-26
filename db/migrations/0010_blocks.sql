-- Blocking: a blocker stops DMs both ways, hides the blocked person's messages behind
-- "Show message", and stops their mentions notifying them.
CREATE TABLE `user_blocks` (
	`blocker_user_id` text NOT NULL,
	`blocked_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`blocker_user_id`, `blocked_user_id`)
);
--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blocked_user_id`);
--> statement-breakpoint
-- Closing a DM hides it from your list until a message newer than this sequence arrives.
CREATE TABLE `dm_hidden` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`hidden_through_sequence` integer NOT NULL,
	PRIMARY KEY(`user_id`, `workspace_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
