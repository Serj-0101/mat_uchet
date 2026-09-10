import { env } from "cloudflare:workers";
import seedAssets from "@/public/seed-assets.json";
import { assignRecordKeys, getComparisonBase } from "@/lib/asset-key";

export type ImportedAsset = {
  sourceNumber: number; recordKey: string;
  inventoryNumber: string; name: string; account?: string; custodian?: string;
  okof?: string; okofName?: string; amortizationGroup?: string; acceptedDate?: string;
  quantity?: number; balanceCost?: number; depreciation?: number; residualCost?: number;
};

export async function ensureSeeded() {
  const db = env.DB;
  if (!db) throw new Error("Хранилище реестра временно недоступно");
  // Один короткий запрос не должен пытаться записать весь исходный реестр:
  // Workers может отменить его, и пользователь увидит только первые строки.
  // Каждый вызов продолжает заполнение с места остановки, а API не отдаёт
  // частичный реестр до завершения этой операции.
  const keyedSeed = assignRecordKeys(seedAssets);
  const stored = await db.prepare("SELECT id,name,inventory_number,accepted_date,record_key,comparison_key FROM assets ORDER BY id").all<{
    id: number; name: string; inventory_number: string; accepted_date: string; record_key: string | null; comparison_key: string | null;
  }>();
  const existingKeys = new Set(stored.results.flatMap((row) => row.record_key ? [row.record_key] : []));
  const storedByRecordKey = new Map(stored.results.flatMap((row) => row.record_key ? [[row.record_key, row] as const] : []));
  const unkeyedByBase = new Map<string, typeof stored.results>();
  for (const row of stored.results) {
    if (row.record_key) continue;
    const base = getComparisonBase({ name:row.name, inventoryNumber:row.inventory_number, acceptedDate:row.accepted_date });
    const group = unkeyedByBase.get(base) ?? []; group.push(row); unkeyedByBase.set(base, group);
  }
  const pending = keyedSeed.flatMap((item) => {
    if (existingKeys.has(item.recordKey)) {
      const existing = storedByRecordKey.get(item.recordKey);
      return existing && !existing.comparison_key ? [{ item, existingId:existing.id }] : [];
    }
    const group = unkeyedByBase.get(getComparisonBase(item)); const existing = group?.shift();
    return [{ item, existingId:existing?.id }];
  });
  const batch = pending.slice(0, 200);
  if (!batch.length) return { complete:true, loaded:keyedSeed.length, total:keyedSeed.length };
  const insertSql = `INSERT OR IGNORE INTO assets
    (source_number,record_key,comparison_key,inventory_number,name,account,custodian,okof,okof_name,amortization_group,accepted_date,quantity,balance_cost,depreciation,residual_cost,note,active,change_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'existing')`;
  await db.batch(batch.map(({ item, existingId }) => existingId
    ? db.prepare("UPDATE assets SET source_number=?,record_key=?,comparison_key=? WHERE id=?").bind(item.sourceNumber, item.recordKey, getComparisonBase(item), existingId)
    : db.prepare(insertSql).bind(
      item.sourceNumber, item.recordKey, getComparisonBase(item), item.inventoryNumber, item.name, item.account, item.custodian, item.okof,
      item.okofName, item.amortizationGroup, item.acceptedDate, item.quantity, item.balanceCost,
      item.depreciation, item.residualCost, ""
    )
  ));
  const loaded = keyedSeed.length - pending.length + batch.length;
  return { complete:loaded >= keyedSeed.length, loaded, total:keyedSeed.length };
}

export const comparableFields: (keyof ImportedAsset)[] = [
  "name", "account", "custodian", "okof", "acceptedDate", "quantity",
  "balanceCost", "depreciation", "residualCost",
];
