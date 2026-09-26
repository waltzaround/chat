-- Slow mode: seconds each member must wait between messages in a channel (0 = off).
ALTER TABLE `channels` ADD `slowmode_seconds` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Words and phrases a workspace doesn't allow, one per line.
ALTER TABLE `workspaces` ADD `word_filter` text DEFAULT '' NOT NULL;
