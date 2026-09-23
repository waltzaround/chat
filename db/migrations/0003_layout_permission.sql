-- Grant the new MANAGE_LAYOUT permission (1 << 17) to every existing default (@everyone) role,
-- matching the default for newly created workspaces.
UPDATE `roles` SET `permissions` = `permissions` | 131072 WHERE `is_default` = 1;
