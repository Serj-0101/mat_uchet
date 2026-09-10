import { env } from "cloudflare:workers";
import { ensureSeeded } from "@/lib/assets";

export async function GET() {
  try {
    await ensureSeeded();
    const db = env.DB;
    if (!db) throw new Error("Хранилище реестра временно недоступно");
    const rows = await db.prepare(`SELECT m.id,m.action,m.recipient,m.event_date as eventDate,m.note,m.created_at as createdAt,a.name,a.inventory_number as inventoryNumber
      FROM movements m JOIN assets a ON a.id=m.asset_id ORDER BY m.id DESC`).all();
    return Response.json({ movements: rows.results });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Ошибка журнала" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await ensureSeeded();
    const db = env.DB;
    if (!db) throw new Error("Хранилище реестра временно недоступно");
    const body = await request.json() as { assetId?: number; action?: "issue" | "return"; recipient?: string; eventDate?: string; note?: string };
    if (!body.assetId || !body.action || !body.eventDate) return Response.json({ error: "Не заполнены обязательные поля" }, { status: 400 });
    if (body.action === "issue" && !body.recipient?.trim()) return Response.json({ error: "Укажите, кому выдано имущество" }, { status: 400 });
    const asset = await db.prepare("SELECT id,issued_to FROM assets WHERE id=?").bind(body.assetId).first<Record<string, unknown>>();
    if (!asset) return Response.json({ error: "Объект не найден" }, { status: 404 });
    if (body.action === "issue" && asset.issued_to) return Response.json({ error: "Объект уже выдан" }, { status: 409 });
    const recipient = body.action === "issue" ? body.recipient!.trim() : String(asset.issued_to ?? "");
    const updates = body.action === "issue"
      ? db.prepare("UPDATE assets SET issued_to=?,issued_at=?,issue_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(recipient, body.eventDate, body.note?.trim() ?? "", body.assetId)
      : db.prepare("UPDATE assets SET issued_to='',issued_at='',issue_note='',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.assetId);
    await db.batch([
      updates,
      db.prepare("INSERT INTO movements(asset_id,action,recipient,event_date,note) VALUES(?,?,?,?,?)").bind(body.assetId, body.action, recipient, body.eventDate, body.note?.trim() ?? "")
    ]);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Ошибка операции" }, { status: 500 }); }
}
