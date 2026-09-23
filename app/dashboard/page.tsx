import { loadPage } from "@/lib/store";
import { SpecCanvas } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Dashboard page — rendered from the voice-built spec in specs/dashboard.json */
export default async function DashboardPage() {
  const page = await loadPage("dashboard");
  return <SpecCanvas page={page} />;
}
