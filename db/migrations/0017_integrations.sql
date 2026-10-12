-- Integrations: incoming webhooks, bots with slash commands, link previews and GitHub.
--
-- Webhooks and bots post as rows in `users` (kind "webhook" or "bot"), so every
-- message keeps a real author and all the apps render them without special cases.
-- These rows have no password and can never sign in.
ALTER TABLE `users` ADD `kind` text NOT NULL DEFAULT 'human';

-- Set on messages a webhook posted.
ALTER TABLE `messages` ADD `webhook_id` text;
-- A webhook may pick a name and avatar per message.
ALTER TABLE `messages` ADD `author_name` text;
ALTER TABLE `messages` ADD `author_avatar_url` text;
-- JSON: rich cards from the author (webhooks and bots), and previews made from links.
ALTER TABLE `messages` ADD `embeds` text;
ALTER TABLE `messages` ADD `link_embeds` text;
-- JSON: rows of buttons (bots only).
ALTER TABLE `messages` ADD `components` text;
-- JSON: the slash command this message answers, e.g. {"name":"deploy","userId":"..."}.
ALTER TABLE `messages` ADD `interaction` text;

-- An incoming webhook posts into one channel. Only a hash of its token is kept.
CREATE TABLE `webhooks` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  `channel_id` text NOT NULL REFERENCES `channels`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `token_hash` text NOT NULL,
  -- Encrypted. GitHub signs its deliveries with it.
  `secret` text NOT NULL,
  -- Its creator could mention @everyone, so the webhook may too.
  `allow_everyone` integer NOT NULL DEFAULT 0,
  `created_by` text NOT NULL REFERENCES `users`(`id`),
  `created_at` integer NOT NULL,
  `last_used_at` integer
);
CREATE INDEX `webhooks_workspace_idx` ON `webhooks` (`workspace_id`);

-- A bot account. The server owner creates it; workspace admins add it to workspaces.
CREATE TABLE `bots` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `owner_user_id` text NOT NULL REFERENCES `users`(`id`),
  `description` text,
  `token_hash` text NOT NULL,
  -- The token's last characters, so the owner can tell tokens apart.
  `token_hint` text NOT NULL,
  -- Where events and slash commands are delivered. Optional.
  `events_url` text,
  -- Encrypted. Signs every delivery so the bot can check it came from here.
  `signing_secret` text NOT NULL,
  `events_failures` integer NOT NULL DEFAULT 0,
  `events_paused_at` integer,
  `last_used_at` integer,
  `created_at` integer NOT NULL
);

CREATE TABLE `bot_commands` (
  `bot_user_id` text NOT NULL REFERENCES `bots`(`user_id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `description` text NOT NULL,
  -- A hint shown after the command, e.g. "<environment>".
  `usage` text,
  PRIMARY KEY (`bot_user_id`, `name`)
);

-- A slash command or a button click, waiting for its bot to answer.
CREATE TABLE `interactions` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `bot_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  `channel_id` text NOT NULL REFERENCES `channels`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  -- command | button
  `kind` text NOT NULL,
  -- The command's name, or the button's id.
  `name` text NOT NULL,
  -- For a button: the message it's on.
  `message_id` text,
  `created_at` integer NOT NULL
);
CREATE INDEX `interactions_created_idx` ON `interactions` (`created_at`);

-- GitHub App installations this server's GitHub App can act for.
CREATE TABLE `github_installations` (
  `id` integer PRIMARY KEY NOT NULL,
  `account_login` text NOT NULL,
  `account_type` text NOT NULL,
  `created_at` integer NOT NULL
);

-- A repository whose activity posts into a channel.
CREATE TABLE `github_subscriptions` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  `channel_id` text NOT NULL REFERENCES `channels`(`id`) ON DELETE CASCADE,
  -- owner/name, lower case.
  `repo` text NOT NULL,
  -- Comma-separated feature names, e.g. "issues,pulls,commits,releases".
  `events` text NOT NULL,
  `created_by` text NOT NULL REFERENCES `users`(`id`),
  `created_at` integer NOT NULL
);
CREATE UNIQUE INDEX `github_subscriptions_channel_repo_idx` ON `github_subscriptions` (`channel_id`, `repo`);
CREATE INDEX `github_subscriptions_repo_idx` ON `github_subscriptions` (`repo`);

-- A person's GitHub account, linked so buttons like "Close issue" act as them.
CREATE TABLE `github_accounts` (
  `user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `github_login` text NOT NULL,
  -- Encrypted.
  `access_token` text NOT NULL,
  `refresh_token` text,
  `expires_at` integer,
  `created_at` integer NOT NULL
);
