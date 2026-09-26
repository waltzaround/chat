-- A direct message conversation is a small workspace (kind 'dm') with two members and
-- one text channel, so it reuses realtime, uploads, reactions, search and read state.
ALTER TABLE `workspaces` ADD `kind` text DEFAULT 'community' NOT NULL;
--> statement-breakpoint
-- One conversation per pair of people. user_a < user_b.
CREATE TABLE `dm_pairs` (
	`user_a` text NOT NULL,
	`user_b` text NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_a`, `user_b`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dm_pairs_user_b_idx` ON `dm_pairs` (`user_b`);
