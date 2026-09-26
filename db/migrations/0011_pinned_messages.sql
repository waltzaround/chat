-- Pinned messages: moderators pin in channels, both people pin in a DM.
ALTER TABLE `messages` ADD `pinned_at` integer;
--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_by` text;
--> statement-breakpoint
CREATE INDEX `messages_pinned_idx` ON `messages` (`channel_id`,`pinned_at`) WHERE `pinned_at` IS NOT NULL;
