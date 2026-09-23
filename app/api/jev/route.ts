/**
 * POST /api/jev  { utterance, pageId }
 *
 * Moore's flow, one Jev call per utterance:
 *   1. capture the utterance (done client-side, via mic or demo script)
 *   2. include the current design (the page spec) as Jev state
 *   3. build the evaluation questions
 *   4. ask Jev once (via lib/jev_bridge.py — credential never touches Node)
 *   5. apply Jev's evaluations as JSON patches
 *   6. client renders the updated spec
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadPage, savePage, listPages } from "@/lib/store";
import { emptyPage, newId } from "@/lib/spec";
import type { PageSpec } from "@/lib/spec";
import { buildJevRequest, applyJevAnswers, shortlistComponents, guessPageId } from "@/lib/jev";

const BRIDGE = path.join(process.cwd(), "lib", "jev_bridge.py");
const PYTHON = path.join(process.cwd(), ".venv", "bin", "python");

/** Navigation verbs are routing, not design decisions — resolve them
 *  deterministically instead of spending a Jev call. Matches utterances like
 *  "start the sign in page" or "start a new marketing page for Benefit Tracker". */
const NAV_RE = /^(?:start|open|go to|switch to|show me|create|new)(?: a| an| the)? ([a-z][a-z\s-]*?) pages?(?: for ([^.]+))?$/i;

/** Honesty for fictional services: mark demo pages as fictional. Returns true if added. */
function addFictionalAlert(pg: PageSpec, utterance: string): boolean {
  if (!/fictional|demo|sample|mock/i.test(utterance)) return false;
  if (pg.nodes.some((n) => n.type === "SiteAlert")) return false;
  pg.nodes.unshift({
    id: newId(pg),
    type: "SiteAlert",
    props: {
      heading: "Demonstration site",
      message: "This is a fictional service built by voice for demonstration purposes.",
      type: "info",
    },
  });
  return true;
}

function titleCase(s: string): string {
  return s.replace(/(^|-)(\w)/g, (_, p1, p2) => `${p1}${p2.toUpperCase()}`);
}

async function askJev(payload: unknown): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [BRIDGE], { timeout: 45000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`jev bridge exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) reject(new Error(parsed.error));
        else resolve(parsed.answers as Record<string, any>);
      } catch {
        reject(new Error(`bad bridge output: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const { utterance, pageId } = (await req.json()) as { utterance?: string; pageId?: string };
    if (!utterance || typeof utterance !== "string") {
      return NextResponse.json({ error: "utterance is required" }, { status: 400 });
    }

    const pages = await listPages();
    let page = pages.find((p) => p.pageId === (pageId || "marketing")) ?? emptyPage(pageId || "marketing");
    if (!pages.some((p) => p.pageId === page.pageId)) pages.push(page);

    // Deterministic navigation: "start the sign in page" is routing, not a
    // design decision. Resolve without spending a Jev call.
    const navMatch = utterance.trim().match(NAV_RE);
    if (navMatch && !/\b(for|with|and)\b/i.test(navMatch[1])) {
      const targetId = guessPageId(navMatch[1]);
      const serviceName = (navMatch[2] || "").split(",")[0].trim();
      const navDecisions = [{ question: "page_intent", choice: "nav", label: `→ ${targetId}`, confidence: null }];
      const applyMeta = (pg: PageSpec) => {
        let touched = false;
        if (serviceName && !pg.title.toLowerCase().includes(serviceName.toLowerCase())) {
          pg.title = `${titleCase(pg.pageId)} — ${serviceName}`;
          touched = true;
        }
        if (addFictionalAlert(pg, utterance)) touched = true;
        return touched;
      };
      if (targetId === page.pageId) {
        if (applyMeta(page)) await savePage(page);
        return NextResponse.json({
          pageId: page.pageId, spec: page, decisions: navDecisions,
          note: `On the "${targetId}" page.`, changed: false,
        });
      }
      let target = pages.find((p) => p.pageId === targetId);
      let note: string;
      if (target) {
        if (applyMeta(target)) await savePage(target);
        note = `Switched to the "${targetId}" page.`;
      } else {
        target = emptyPage(targetId);
        applyMeta(target);
        await savePage(target);
        note = `Started a new page: "${targetId}".`;
      }
      return NextResponse.json({
        pageId: target.pageId, spec: target, decisions: navDecisions,
        note, changed: false, pageSwitch: target.pageId,
      });
    }

    const candidates = shortlistComponents(utterance);
    const jevReq = buildJevRequest(utterance, page, pages);
    const answers = await askJev(jevReq);
    const result = applyJevAnswers(utterance, page, pages, candidates, answers);

    // Page routing: Jev said this utterance is about another page.
    if (result.pageSwitch && result.pageSwitch !== "__newpage__") {
      const target = await loadPage(result.pageSwitch);
      return NextResponse.json({
        pageId: target.pageId,
        spec: target,
        decisions: result.decisions,
        note: result.note,
        changed: false,
        pageSwitch: target.pageId,
      });
    }
    if (result.pageSwitch === "__newpage__") {
      const newPageId = guessPageId(utterance);
      const fresh = emptyPage(newPageId);
      addFictionalAlert(fresh, utterance);
      await savePage(fresh);
      return NextResponse.json({
        pageId: fresh.pageId,
        spec: fresh,
        decisions: result.decisions,
        note: `Started a new page: "${newPageId}".`,
        changed: false,
        pageSwitch: fresh.pageId,
      });
    }

    if (result.changed) {
      addFictionalAlert(page, utterance);
      await savePage(page);
    }
    return NextResponse.json({
      pageId: page.pageId,
      spec: page,
      decisions: result.decisions,
      note: result.note,
      changed: result.changed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
