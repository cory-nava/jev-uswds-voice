/** GET /api/pages — list page specs. DELETE /api/pages — reset demo (clear specs). */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listPages } from "@/lib/store";

export async function GET() {
  const pages = await listPages();
  return NextResponse.json({ pages });
}

export async function DELETE() {
  const dir = path.join(process.cwd(), "specs");
  try {
    const files = await fs.readdir(dir);
    await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => fs.unlink(path.join(dir, f))));
  } catch {
    /* nothing to clear */
  }
  return NextResponse.json({ ok: true });
}
