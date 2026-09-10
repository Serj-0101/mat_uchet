import { env } from "cloudflare:workers";

export async function GET() {
  try {
    const db=env.DB;
    if(!db) throw new Error("Хранилище реестра временно недоступно");
    await db.prepare("DELETE FROM archived_assets WHERE expires_at<=CURRENT_TIMESTAMP").run();
    const rows=await db.prepare("SELECT * FROM archived_assets ORDER BY deleted_at DESC,id DESC").all();
    return Response.json({archived:rows.results});
  } catch(error) { return Response.json({error:error instanceof Error?error.message:"Не удалось загрузить архив"},{status:500}); }
}

export async function DELETE(request:Request) {
  try {
    const db=env.DB;if(!db)throw new Error("Хранилище реестра временно недоступно");
    const body=await request.json() as {from?:string;to?:string};const from=String(body.from??"");const to=String(body.to??"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return Response.json({error:"Укажите корректный диапазон дат"},{status:400});
    const result=await db.prepare("DELETE FROM archived_assets WHERE date(deleted_at) BETWEEN date(?) AND date(?)").bind(from,to).run();
    return Response.json({deleted:Number(result.meta.changes??0)});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Не удалось очистить архив"},{status:500});}
}
