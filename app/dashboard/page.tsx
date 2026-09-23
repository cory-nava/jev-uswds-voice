import { loadPage } from "@/lib/store";
import { SpecCanvas } from "@/lib/registry";

export const dynamic = "force-dynamic";

/** Dashboard page — rendered from the voice-built spec in specs/dashboard.json */
export default async function DashboardPage() {
  const page = await loadPage("dashboard");
  return (
    <div className="grid-container margin-y-4">
      <SpecCanvas page={page} />
    </div>
  );
}
