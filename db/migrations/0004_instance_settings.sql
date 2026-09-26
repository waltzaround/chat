-- Per-deployment settings the Worker creates for itself (e.g. a generated
-- auth secret when BETTER_AUTH_SECRET is not set). Read with raw SQL in
-- worker/instance.ts, so it is intentionally not part of the Drizzle schema.
CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);

-- Deployments that already have accounts: the earliest account is the server owner.
-- Their sign-up policy stays "open" (the default when unset), as it was before.
INSERT OR IGNORE INTO `instance_settings` (`key`, `value`)
SELECT 'owner_user_id', `id` FROM `users` ORDER BY `created_at` LIMIT 1;
