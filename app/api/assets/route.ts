import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { ensureSeeded } from "@/lib/assets";
import { getComparisonBase } from "@/lib/asset-key";

export async function GET() {
  try {
    const initialization = await ensureSeeded();
    if (!initialization.complete) {
      return Response.json({ initialization }, { status: 202 });
    }
    const rows = await getDb().select().from(assets).where(eq(assets.active, true)).orderBy(asc(assets.sourceNumber));
    return Response.json({ assets: rows, initialization });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить реестр" }, { status: 500 });
  }
}

export async function POST(request:Request) {
  try {
    const initialization=await ensureSeeded();
    if(!initialization.complete)return Response.json({error:"Реестр ещё подготавливается"},{status:409});
    const db=env.DB;if(!db)throw new Error("Хранилище реестра временно недоступно");
    const body=await request.json() as Record<string,unknown>;
    const sourceNumber=Number(body.sourceNumber);const name=String(body.name??"").trim();const inventoryNumber=String(body.inventoryNumber??"").trim();const acceptedDate=String(body.acceptedDate??"").trim();const note=String(body.note??"").trim();
    if(!Number.isInteger(sourceNumber)||sourceNumber<1)return Response.json({error:"Укажите корректный уникальный номер строки"},{status:400});
    if(!name||!acceptedDate||!note)return Response.json({error:"Заполните наименование, дату принятия к учёту и примечание"},{status:400});
    const duplicate=await db.prepare("SELECT id FROM assets WHERE active=1 AND source_number=? LIMIT 1").bind(sourceNumber).first();
    if(duplicate)return Response.json({error:`Строка №${sourceNumber} уже существует в реестре`},{status:409});
    const comparisonKey=getComparisonBase({name,inventoryNumber,acceptedDate});
    await db.prepare(`INSERT INTO assets(source_number,record_key,comparison_key,inventory_number,name,account,custodian,okof,okof_name,amortization_group,accepted_date,quantity,balance_cost,depreciation,residual_cost,note,active,change_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'new')`).bind(sourceNumber,`${comparisonKey}#asset-${crypto.randomUUID()}`,comparisonKey,inventoryNumber,name,String(body.account??"").trim(),String(body.custodian??"").trim(),String(body.okof??"").trim(),String(body.okofName??"").trim(),String(body.amortizationGroup??"").trim(),acceptedDate,Number(body.quantity??0)||0,Number(body.balanceCost??0)||0,Number(body.depreciation??0)||0,Number(body.residualCost??0)||0,note).run();
    return Response.json({created:true},{status:201});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Не удалось добавить запись"},{status:500});}
}

export async function DELETE(request:Request) {
  try {
    const db=env.DB;if(!db)throw new Error("Хранилище реестра временно недоступно");
    const id=Number(new URL(request.url).searchParams.get("id"));
    if(!Number.isInteger(id)||id<1)return Response.json({error:"Некорректный идентификатор записи"},{status:400});
    const row=await db.prepare("SELECT * FROM assets WHERE id=? AND active=1").bind(id).first<Record<string,unknown>>();
    if(!row)return Response.json({error:"Запись не найдена или уже удалена"},{status:404});
    const comparisonKey=String(row.comparison_key??getComparisonBase({name:String(row.name??""),inventoryNumber:String(row.inventory_number??""),acceptedDate:String(row.accepted_date??"")}));
    await db.batch([
      db.prepare(`INSERT INTO archived_assets(original_asset_id,source_number,comparison_key,name,inventory_number,accepted_date,data_json,expires_at) VALUES(?,?,?,?,?,?,?,datetime('now','+1 year'))`).bind(id,row.source_number??null,comparisonKey,String(row.name??""),String(row.inventory_number??""),String(row.accepted_date??""),JSON.stringify(row)),
      db.prepare("UPDATE assets SET active=0,change_status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id),
    ]);
    return Response.json({deleted:true});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Не удалось удалить запись"},{status:500});}
}
