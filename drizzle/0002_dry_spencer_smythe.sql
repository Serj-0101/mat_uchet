CREATE TABLE `archived_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_asset_id` integer NOT NULL,
	`source_number` integer,
	`comparison_key` text NOT NULL,
	`name` text NOT NULL,
	`inventory_number` text DEFAULT '' NOT NULL,
	`accepted_date` text DEFAULT '' NOT NULL,
	`data_json` text NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_archived_assets_comparison_key` ON `archived_assets` (`comparison_key`);--> statement-breakpoint
CREATE INDEX `idx_archived_assets_expires_at` ON `archived_assets` (`expires_at`);--> statement-breakpoint
ALTER TABLE `assets` ADD `comparison_key` text;--> statement-breakpoint
CREATE INDEX `idx_assets_comparison_key` ON `assets` (`comparison_key`);