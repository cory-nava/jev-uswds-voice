import { notFound } from "next/navigation";
import { loadPage } from "@/lib/store";
import { SpecCanvas } from "@/lib/registry";

export const dynamic = "force-dynamic";

/**
 * Dynamic page route — renders any voice-built spec by id.
 * The hand-built routes (marketing, signin, dashboard,
 * profile) take precedence over this dynamic segment.
 */
export default async function DynamicPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  let page;
  try {
    page = await loadPage(pageId);
  } catch {
    notFound();
  }
  return <SpecCanvas page={page} />;
}
