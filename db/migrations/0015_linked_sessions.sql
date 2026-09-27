-- Linked sessions: another Chat server (or the desktop app) showing this account's
-- workspaces and unread counts in its server rail. They may only read that summary.
ALTER TABLE `sessions` ADD `scope` text;
