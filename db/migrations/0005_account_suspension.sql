-- Server owner can suspend an account: it cannot sign in and its sessions are revoked.
ALTER TABLE `users` ADD `suspended_at` integer;
