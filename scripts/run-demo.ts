/**
 * Replays lib/demo-script.ts through the live /api/jev pipeline, like the
 * voice planner's "Play demo script": pages start blank (current pages move
 * to the trash), one tracked current page, updated from each response.
 *
 * Usage: pnpm demo            (server at http://localhost:3100)
 *        DEMO_URL=http://localhost:3199 pnpm demo
 */
import { DEMO_SCRIPT } from "../lib/demo-script";

const BASE = process.env.DEMO_URL ?? "http://localhost:3100";

async function main() {
  await fetch(`${BASE}/api/pages?mode=empty`, { method: "DELETE" });
  let currentPageId = "marketing";
  let failures = 0;
  for (const [i, step] of DEMO_SCRIPT.entries()) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/jev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utterance: step.utterance, pageId: step.pageId ?? currentPageId }),
    });
    const data = await res.json();
    if (data.pageId) currentPageId = data.pageId;
    // Page switches ("start the sign in page") don't change content but did their job.
    const switched = data.pageSwitch || /^(?:Started|Switched|On the)\b/.test(data.note ?? "");
    const status = !res.ok ? "ERROR" : data.changed || switched ? "ok" : "NO CHANGE";
    if (status !== "ok") failures++;
    console.log(`[${i + 1}/${DEMO_SCRIPT.length}] ${Date.now() - t0}ms ${status} /${data.pageId ?? currentPageId}`);
    console.log(`   "${step.utterance}"`);
    console.log(`   -> ${res.ok ? data.note : data.error}`);
  }
  console.log(failures === 0 ? "\nALL STEPS CHANGED THE PAGE" : `\n${failures} step(s) made no change or failed`);
  process.exit(failures ? 1 : 0);
}

void main();
