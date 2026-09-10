CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inventory_number` text NOT NULL,
	`name` text NOT NULL,
	`account` text DEFAULT '' NOT NULL,
	`custodian` text DEFAULT '' NOT NULL,
	`okof` text DEFAULT '' NOT NULL,
	`okof_name` text DEFAULT '' NOT NULL,
	`amortization_group` text DEFAULT '' NOT NULL,
	`accepted_date` text DEFAULT '' NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`balance_cost` real DEFAULT 0 NOT NULL,
	`depreciation` real DEFAULT 0 NOT NULL,
	`residual_cost` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`issued_to` text DEFAULT '' NOT NULL,
	`issued_at` text DEFAULT '' NOT NULL,
	`issue_note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`change_status` text DEFAULT 'existing' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assets_inventory_number` ON `assets` (`inventory_number`);--> statement-breakpoint
CREATE INDEX `idx_assets_change_status` ON `assets` (`change_status`);--> statement-breakpoint
CREATE INDEX `idx_assets_issued_to` ON `assets` (`issued_to`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`added_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`missing_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`action` text NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`event_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_movements_asset_id` ON `movements` (`asset_id`);