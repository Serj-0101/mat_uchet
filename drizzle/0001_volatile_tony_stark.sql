DROP INDEX `uq_assets_inventory_number`;--> statement-breakpoint
ALTER TABLE `assets` ADD `source_number` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `record_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assets_record_key` ON `assets` (`record_key`);--> statement-breakpoint
CREATE INDEX `idx_assets_source_number` ON `assets` (`source_number`);