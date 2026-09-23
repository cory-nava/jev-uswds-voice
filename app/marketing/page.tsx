import { loadPage } from "@/lib/store";
import { SpecCanvas } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Marketing page — rendered from the voice-built spec in specs/marketing.json */
export default async function MarketingPage() {
  const page = await loadPage("marketing");
  return <SpecCanvas page={page} />;
}
