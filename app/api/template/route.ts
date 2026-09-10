import { env } from "cloudflare:workers";

const key = "templates/act-template.docx";

export async function GET() {
  try {
    const bucket = env.BUCKET;
    if (!bucket) return new Response(null, { status: 404 });
    const object = await bucket.get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": "attachment; filename=act-template.docx" } });
  } catch { return new Response(null, { status: 404 }); }
}

export async function POST(request: Request) {
  try {
    const bucket = env.BUCKET;
    if (!bucket) throw new Error("Хранилище шаблонов временно недоступно");
    const data = await request.arrayBuffer();
    if (!data.byteLength || data.byteLength > 10_000_000) return Response.json({ error: "Размер шаблона должен быть до 10 МБ" }, { status: 400 });
    await bucket.put(key, data, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Не удалось сохранить шаблон" }, { status: 500 }); }
}
