-- Threads: a reply is a message in the same channel pointing at its root. The root
-- keeps a reply count and the time of the latest reply for the "3 replies" line.
ALTER TABLE `messages` ADD `thread_root_id` text;
--> statement-breakpoint
ALTER TABLE `messages` ADD `thread_reply_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD `thread_last_reply_at` integer;
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_root_id`,`channel_sequence`) WHERE `thread_root_id` IS NOT NULL;
