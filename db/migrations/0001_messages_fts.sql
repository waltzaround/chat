-- Full-text search over message content. Kept in sync with triggers so the
-- application never has to write to the FTS table directly.
CREATE VIRTUAL TABLE IF NOT EXISTS `messages_fts` USING fts5(
  `content`,
  `message_id` UNINDEXED,
  `channel_id` UNINDEXED,
  `workspace_id` UNINDEXED,
  `author_user_id` UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS `messages_fts_insert` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `messages_fts` (`content`, `message_id`, `channel_id`, `workspace_id`, `author_user_id`)
  VALUES (new.`content`, new.`id`, new.`channel_id`, new.`workspace_id`, new.`author_user_id`);
END;

CREATE TRIGGER IF NOT EXISTS `messages_fts_update` AFTER UPDATE OF `content`, `deleted_at` ON `messages` BEGIN
  DELETE FROM `messages_fts` WHERE `message_id` = old.`id`;
  INSERT INTO `messages_fts` (`content`, `message_id`, `channel_id`, `workspace_id`, `author_user_id`)
  SELECT new.`content`, new.`id`, new.`channel_id`, new.`workspace_id`, new.`author_user_id`
  WHERE new.`deleted_at` IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS `messages_fts_delete` AFTER DELETE ON `messages` BEGIN
  DELETE FROM `messages_fts` WHERE `message_id` = old.`id`;
END;
