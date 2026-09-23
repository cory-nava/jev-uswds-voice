/** GET /api/pages — list page specs. DELETE /api/pages — reset demo (clear specs, undo history, and the trash). */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listPages, historyCounts, clearHistory, clearTrash } from "@/lib/store";

export async function GET() {
  const pages = await listPages();
  const history = Object.fromEntries(await Promise.all(pages.map(async (p) => [p.pageId, await historyCounts(p.pageId)] as const)));
  return NextResponse.json({ pages, history });
}

export async function DELETE() {
  const dir = path.join(process.cwd(), "specs");
  try {
    const files = await fs.readdir(dir);
    await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => fs.unlink(path.join(dir, f))));
  } catch {
    /* nothing to clear */
  }
  await clearHistory();
  await clearTrash();
  return NextResponse.json({ ok: true });
}
