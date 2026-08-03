CREATE TABLE `mod_roles_member_roles` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`source` text NOT NULL CHECK (`source` IN ('panel','rule','manual','restore','tier','entry')),
	`granted_by` text,
	`granted_at` integer NOT NULL,
	PRIMARY KEY (`guild_id`, `user_id`, `role_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `idx_mod_roles_member_roles_guild_role` ON `mod_roles_member_roles` (`guild_id`,`role_id`);
--> statement-breakpoint
CREATE TABLE `mod_roles_snapshots` (
	`guild_id` text NOT NULL,
	`user_id` text NOT NULL,
	`taken_at` integer NOT NULL,
	`roles_json` text NOT NULL,
	`reason` text NOT NULL DEFAULT 'unknown' CHECK (`reason` IN ('leave','kick','ban','unknown','pre_sanction','manual')),
	`actor_id` text,
	`partial` integer NOT NULL DEFAULT 0 CHECK (`partial` IN (0,1)),
	`restore_state` text NOT NULL DEFAULT 'none' CHECK (`restore_state` IN ('none','pending','done')),
	`restored_at` integer,
	PRIMARY KEY (`guild_id`, `user_id`, `taken_at`)
);
--> statement-breakpoint
CREATE INDEX `idx_mod_roles_snapshots_pending` ON `mod_roles_snapshots` (`guild_id`,`restore_state`) WHERE `restore_state` = 'pending';
--> statement-breakpoint
CREATE TABLE `mod_roles_panels` (
	`guild_id` text NOT NULL,
	`panel_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`surface` text NOT NULL CHECK (`surface` IN ('reaction','button')),
	`config_json` text NOT NULL,
	`status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','broken')),
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`guild_id`, `panel_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mod_roles_panels_message` ON `mod_roles_panels` (`message_id`) WHERE `message_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_mod_roles_panels_lookup` ON `mod_roles_panels` (`guild_id`,`message_id`);
