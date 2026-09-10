import { env } from "cloudflare:workers";
import { ensureSeeded, type ImportedAsset } from "@/lib/assets";
import { assignRecordKeys, getComparisonBase } from "@/lib/asset-key";

type StoredAsset = Record<string, unknown> & { id:number; comparison_key:string | null };
const clean = (value: unknown) => typeof value === "number" ? value : String(value ?? "").trim();
const sortStored = (a: StoredAsset, b: StoredAsset) => Number(a.source_number ?? a.id) - Number(b.source_number ?? b.id);

function changed(row: ImportedAsset, old: StoredAsset) {
  return clean(row.name) !== clean(old.name) || clean(row.inventoryNumber) !== clean(old.inventory_number)
    || clean(row.account) !== clean(old.account) || clean(row.custodian) !== clean(old.custodian)
    || clean(row.okof) !== clean(old.okof) || clean(row.okofName) !== clean(old.okof_name)
    || clean(row.amortizationGroup) !== clean(old.amortization_group) || clean(row.acceptedDate) !== clean(old.accepted_date)
    || clean(row.quantity) !== clean(old.quantity) || clean(row.balanceCost) !== clean(old.balance_cost)
    || clean(row.depreciation) !== clean(old.depreciation) || clean(row.residualCost) !== clean(old.residual_cost);
}

export async function POST(request: Request) {
  try {
    const initialization = await ensureSeeded();
    if (!initialization.complete) return Response.json({ error:"Исходный реестр ещё загружается. Повторите импорт после завершения загрузки." }, { status:409 });
    const db = env.DB;
    if (!db) throw new Error("Хранилище реестра временно недоступно");
    const body = await request.json() as { fileName?:string; records?:ImportedAsset[]; addKeys?:string[]; deleteIds?:number[]; notes?:Record<string,string> };
    const submitted = body.records ?? [];
    if (!submitted.length) return Response.json({ error:"Файл не содержит записей" }, { status:400 });
    const sourceNumbers = new Set<number>();
    for (const row of submitted) {
      if (!Number.isInteger(row.sourceNumber) || row.sourceNumber < 1 || sourceNumbers.has(row.sourceNumber)) return Response.json({ error:`Некорректный или повторяющийся номер строки: ${row.sourceNumber}` }, { status:400 });
      sourceNumbers.add(row.sourceNumber);
    }
    const records = assignRecordKeys([...submitted].sort((a,b)=>a.sourceNumber-b.sourceNumber));
    const current = await db.prepare("SELECT * FROM assets WHERE active=1 ORDER BY source_number,id").all<StoredAsset>();
    const incomingGroups = new Map<string, typeof records>(); const currentGroups = new Map<string, StoredAsset[]>();
    for (const row of records) { const key=getComparisonBase(row); const group=incomingGroups.get(key)??[]; group.push(row); incomingGroups.set(key,group); }
    for (const row of current.results) { const key=row.comparison_key ?? getComparisonBase({name:String(row.name??""),inventoryNumber:String(row.inventory_number??""),acceptedDate:String(row.accepted_date??"")}); const group=currentGroups.get(key)??[]; group.push(row); currentGroups.set(key,group); }
    for (const group of currentGroups.values()) group.sort(sortStored);
    const validAdds = new Map<string, (typeof records)[number]>(); const validDeletes = new Map<number, StoredAsset>();
    const matched: Array<{ incoming:(typeof records)[number]; stored:StoredAsset; key:string }> = [];
    for (const key of new Set([...incomingGroups.keys(), ...currentGroups.keys()])) {
      const incoming=incomingGroups.get(key)??[]; const stored=currentGroups.get(key)??[]; const common=Math.min(incoming.length,stored.length);
      for(let i=0;i<common;i+=1) matched.push({incoming:incoming[i],stored:stored[i],key});
      for(const row of incoming.slice(common)) validAdds.set(row.recordKey,row);
      for(const row of stored.slice(common)) validDeletes.set(row.id,row);
    }
    const addKeys=new Set(body.addKeys??[]); const deleteIds=new Set(body.deleteIds??[]);
    for(const key of addKeys) if(!validAdds.has(key)) return Response.json({error:"Список добавляемых строк устарел. Выполните сверку заново."},{status:409});
    for(const id of deleteIds) if(!validDeletes.has(id)) return Response.json({error:"Список удаляемых строк устарел. Выполните сверку заново."},{status:409});
    if([...addKeys].some((key)=>!body.notes?.[key]?.trim())) return Response.json({error:"Для каждой добавляемой записи заполните поле «примечание»."},{status:400});

    let changedCount=0;
    for(let i=0;i<matched.length;i+=60) await db.batch(matched.slice(i,i+60).map(({incoming,stored,key})=>{
      const hasChanged=changed(incoming,stored); if(hasChanged) changedCount+=1;
      return db.prepare(`UPDATE assets SET source_number=?,comparison_key=?,inventory_number=?,name=?,account=?,custodian=?,okof=?,okof_name=?,amortization_group=?,accepted_date=?,quantity=?,balance_cost=?,depreciation=?,residual_cost=?,change_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
        incoming.sourceNumber,key,incoming.inventoryNumber,incoming.name,incoming.account??"",incoming.custodian??"",incoming.okof??"",incoming.okofName??"",incoming.amortizationGroup??"",incoming.acceptedDate??"",Number(incoming.quantity??0),Number(incoming.balanceCost??0),Number(incoming.depreciation??0),Number(incoming.residualCost??0),hasChanged?"changed":"unchanged",stored.id);
    }));
    const additions=[...addKeys].map((key)=>validAdds.get(key)!);
    for(let i=0;i<additions.length;i+=60) await db.batch(additions.slice(i,i+60).map((row)=>db.prepare(`INSERT INTO assets
      (source_number,record_key,comparison_key,inventory_number,name,account,custodian,okof,okof_name,amortization_group,accepted_date,quantity,balance_cost,depreciation,residual_cost,note,active,change_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'new')`).bind(row.sourceNumber,`${getComparisonBase(row)}#asset-${crypto.randomUUID()}`,getComparisonBase(row),row.inventoryNumber,row.name,row.account??"",row.custodian??"",row.okof??"",row.okofName??"",row.amortizationGroup??"",row.acceptedDate??"",Number(row.quantity??0),Number(row.balanceCost??0),Number(row.depreciation??0),Number(row.residualCost??0),body.notes?.[row.recordKey]?.trim()??"")));
    const deletions=[...deleteIds].map((id)=>validDeletes.get(id)!);
    for(const row of deletions) {
      const key=row.comparison_key??getComparisonBase({name:String(row.name??""),inventoryNumber:String(row.inventory_number??""),acceptedDate:String(row.accepted_date??"")});
      await db.batch([
        db.prepare(`INSERT INTO archived_assets(original_asset_id,source_number,comparison_key,name,inventory_number,accepted_date,data_json,expires_at) VALUES(?,?,?,?,?,?,?,datetime('now','+1 year'))`).bind(row.id,row.source_number??null,key,String(row.name??""),String(row.inventory_number??""),String(row.accepted_date??""),JSON.stringify(row)),
        db.prepare("UPDATE assets SET active=0,change_status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id),
      ]);
    }
    await db.prepare("DELETE FROM archived_assets WHERE expires_at<=CURRENT_TIMESTAMP").run();
    await db.prepare("INSERT INTO import_batches(file_name,added_count,changed_count,missing_count,total_count) VALUES(?,?,?,?,?)").bind(body.fileName??"Бухгалтерия.xlsx",additions.length,changedCount,deletions.length,records.length).run();
    return Response.json({added:additions.length,changed:changedCount,deleted:deletions.length,total:records.length});
  } catch (error) { return Response.json({error:error instanceof Error?error.message:"Ошибка импорта"},{status:500}); }
}
