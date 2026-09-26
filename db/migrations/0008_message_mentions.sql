-- Who each message notifies: @username, a reply's author, and the members reached by
-- @everyone / @here. Unread mention badges count these past the reader's read marker.
CREATE TABLE `message_mentions` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_mentions_user_idx` ON `message_mentions` (`user_id`,`channel_id`,`sequence`);
