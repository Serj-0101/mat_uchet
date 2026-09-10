import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceNumber: integer("source_number"),
  recordKey: text("record_key"),
  comparisonKey: text("comparison_key"),
  inventoryNumber: text("inventory_number").notNull(),
  name: text("name").notNull(),
  account: text("account").notNull().default(""),
  custodian: text("custodian").notNull().default(""),
  okof: text("okof").notNull().default(""),
  okofName: text("okof_name").notNull().default(""),
  amortizationGroup: text("amortization_group").notNull().default(""),
  acceptedDate: text("accepted_date").notNull().default(""),
  quantity: real("quantity").notNull().default(0),
  balanceCost: real("balance_cost").notNull().default(0),
  depreciation: real("depreciation").notNull().default(0),
  residualCost: real("residual_cost").notNull().default(0),
  note: text("note").notNull().default(""),
  issuedTo: text("issued_to").notNull().default(""),
  issuedAt: text("issued_at").notNull().default(""),
  issueNote: text("issue_note").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  changeStatus: text("change_status").notNull().default("existing"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_assets_record_key").on(table.recordKey),
  index("idx_assets_source_number").on(table.sourceNumber),
  index("idx_assets_comparison_key").on(table.comparisonKey),
  index("idx_assets_change_status").on(table.changeStatus),
  index("idx_assets_issued_to").on(table.issuedTo),
]);

export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assetId: integer("asset_id").notNull().references(() => assets.id),
  action: text("action").notNull(),
  recipient: text("recipient").notNull().default(""),
  eventDate: text("event_date").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_movements_asset_id").on(table.assetId)]);

export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileName: text("file_name").notNull(),
  addedCount: integer("added_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  missingCount: integer("missing_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const archivedAssets = sqliteTable("archived_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalAssetId: integer("original_asset_id").notNull(),
  sourceNumber: integer("source_number"),
  comparisonKey: text("comparison_key").notNull(),
  name: text("name").notNull(),
  inventoryNumber: text("inventory_number").notNull().default(""),
  acceptedDate: text("accepted_date").notNull().default(""),
  dataJson: text("data_json").notNull(),
  deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("idx_archived_assets_comparison_key").on(table.comparisonKey),
  index("idx_archived_assets_expires_at").on(table.expiresAt),
]);
