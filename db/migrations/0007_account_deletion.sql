-- Deleted accounts are anonymised rather than removed, so their messages keep a valid
-- author. deleted_at marks them; the name, email and username are scrubbed.
ALTER TABLE `users` ADD `deleted_at` integer;
--> statement-breakpoint
-- Finding everything one person wrote: account deletion and data export.
CREATE INDEX `messages_author_idx` ON `messages` (`author_user_id`,`created_at`);
