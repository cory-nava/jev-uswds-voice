/**
 * GET /api/pages — list page specs and their undo counts.
 * DELETE /api/pages?mode=samples (default) — Reset: current pages go to the
 * trash and the sample pages (lib/templates/) come back.
 * DELETE /api/pages?mode=empty — same, but leaves no pages (the demo script
 * builds everything from blank).
 */
import { NextRequest, NextResponse } from "next/server";
import { listPages, historyCounts } from "@/lib/store";
import { resetPages } from "@/lib/templates";

export async function GET() {
  const pages = await listPages();
  const history = Object.fromEntries(await Promise.all(pages.map(async (p) => [p.pageId, await historyCounts(p.pageId)] as const)));
  return NextResponse.json({ pages, history });
}

export async function DELETE(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "empty" ? "empty" : "samples";
  return NextResponse.json({ ok: true, ...(await resetPages(mode)) });
}
