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
 *
 * Before any Jev call, deterministic handlers get first pick, in order: help
 * and read-back, undo/redo (with counts), page commands, corrections ("no, I
 * meant …"), navigation, several commands in one utterance, then direct edits.
 * Conversation helpers live in lib/session.ts and lib/session-store.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadPage, commitPage, listPages, stepHistory, historyCounts } from "@/lib/store";
import { emptyPage, newId } from "@/lib/spec";
import type { PageSpec } from "@/lib/spec";
import { NAV_RE, isHelpRequest, isOutlineRequest, parseUndoCount, splitCommands } from "@/lib/intents";
import { guessPageId, seedNewPage, type Decision } from "@/lib/jev";
import { applyPageCommand } from "@/lib/page-commands";
import { applyUtterance, commandDecision, correctedUtterance, outline, parseCorrection, type Correction } from "@/lib/session";
import { markApplied, readSession, remember, stepMany } from "@/lib/session-store";

const BRIDGE = path.join(process.cwd(), "lib", "jev_bridge.py");
const PYTHON = process.env.JEV_PYTHON || path.join(process.cwd(), ".venv", "bin", "python");

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
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(`Python not found at ${PYTHON} — run \`pnpm setup:py\` (or set JEV_PYTHON)`));
      } else {
        reject(err);
      }
    });
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

const clone = (p: PageSpec): PageSpec => JSON.parse(JSON.stringify(p));

/** "undo", "undo the last three changes", "redo twice", "undo everything". */
async function undoRedo(page: PageSpec, direction: "undo" | "redo", count: number | "all") {
  const { restored, steps } = await stepMany(page.pageId, direction, count);
  const counts = await historyCounts(page.pageId);
  if (steps) await markApplied(page.pageId, direction === "redo");
  const verb = direction === "undo" ? "Undid" : "Redid";
  const asked = count === "all" ? null : count;
  const note = !steps
    ? `Nothing to ${direction} on "${page.pageId}".`
    : count === "all"
      ? `${verb} all ${steps} change${steps === 1 ? "" : "s"} on "${page.pageId}".`
      : steps === 1 && asked === 1
        ? `${verb} the last change on "${page.pageId}".`
        : `${verb} ${steps} change${steps === 1 ? "" : "s"} on "${page.pageId}"${asked && steps < asked ? ` (only ${steps} to ${direction})` : ""}.`;
  return {
    pageId: page.pageId,
    spec: restored ?? page,
    decisions: [{ question: "history", choice: direction, label: `${direction} ×${steps} (${counts.undo} undo / ${counts.redo} redo left)`, confidence: null }],
    note,
    changed: steps > 0,
  };
}

/** Undo the last change on the page and re-apply it with the corrected element. */
async function correct(correction: Correction, page: PageSpec, pages: PageSpec[]) {
  const reply = (spec: PageSpec, note: string, changed: boolean, decisions: Decision[] = []) => ({
    pageId: spec.pageId, spec, decisions: [commandDecision("correction"), ...decisions], note, changed,
  });
  const rec = await readSession(page.pageId);
  if (!rec) return reply(page, "Nothing to correct yet — I don't have a previous change on this page.", false);
  let base = page;
  if (rec.changed) {
    const undone = await stepHistory(page.pageId, "undo");
    if (!undone) return reply(page, "Nothing to undo on this page, so there's nothing to correct.", false);
    base = undone;
  }
  const restore = async (why: string) => {
    const back = rec.changed ? await stepHistory(page.pageId, "redo") : null;
    return reply(back ?? base, why, false);
  };
  // "it" in the retried command still means the element the correction is about.
  if (rec.targetId) base.lastTouched = rec.targetId;
  const retry = correctedUtterance(rec, correction, base);
  if (!retry) return restore(`I couldn't tell which part of "${rec.utterance}" to swap for "${correction.phrase}" — say the whole command again.`);
  const before = clone(base);
  let step: Awaited<ReturnType<typeof applyUtterance>>;
  try {
    step = await applyUtterance(retry, base, pages, askJev);
  } catch (err) {
    if (rec.changed) await stepHistory(page.pageId, "redo");
    throw err;
  }
  if (!step.changed || step.pageSwitch) return restore(`Tried "${retry}" instead, but it didn't apply: ${step.note}`);
  await commitPage(base);
  await remember(retry, before, base);
  return {
    ...reply(base, `${rec.changed ? `Undid "${rec.utterance}" and did` : "Did"} "${retry}" instead. ${step.note}`, true, step.decisions),
    candidates: step.candidates,
  };
}

/** Apply each part in order through the normal pipeline, then save once so it's one undo step. */
async function applyMany(parts: string[], utterance: string, page: PageSpec, pages: PageSpec[]) {
  const before = clone(page);
  const decisions: Decision[] = [];
  const notes: string[] = [];
  const candidates: string[] = [];
  let changed = false;
  for (const [i, part] of parts.entries()) {
    decisions.push({ question: "step", choice: String(i + 1), label: part, confidence: null });
    const step = await applyUtterance(part, page, pages, askJev);
    if (step.pageSwitch) {
      notes.push(`${i + 1}. Skipped "${part}" (that's about another page — say it on its own).`);
      continue;
    }
    decisions.push(...step.decisions);
    candidates.push(...(step.candidates ?? []).filter((c) => !candidates.includes(c)));
    notes.push(`${i + 1}. ${step.note}`);
    changed ||= step.changed;
  }
  if (changed) {
    addFictionalAlert(page, utterance);
    await commitPage(page);
    await remember(utterance, before, page);
  }
  return { pageId: page.pageId, spec: page, decisions, candidates, note: `${parts.length} steps: ${notes.join(" ")}`, changed };
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
    const trimmed = utterance.trim();

    // Help and read-back: answered from the page, nothing changes.
    if (isHelpRequest(trimmed)) {
      return NextResponse.json({
        pageId: page.pageId, spec: page, decisions: [commandDecision("help")],
        note: "Opening the voice command reference in a new tab.", changed: false, openUrl: "/commands",
      });
    }
    if (isOutlineRequest(trimmed)) {
      return NextResponse.json({ pageId: page.pageId, spec: page, decisions: [commandDecision("outline", "read back")], note: outline(page), changed: false });
    }

    // Undo / redo on the current page, one or several steps.
    const history = parseUndoCount(trimmed);
    if (history) return NextResponse.json(await undoRedo(page, history.direction, history.count));

    // Page management: rename, delete, duplicate, retitle, start over.
    const pageCmd = await applyPageCommand(utterance, page.pageId);
    if (pageCmd) {
      return NextResponse.json({
        pageId: pageCmd.pageId,
        spec: pageCmd.spec ?? (await loadPage(pageCmd.pageId)),
        decisions: [commandDecision("page", "page command")],
        note: pageCmd.note,
        changed: pageCmd.changed,
        ...(pageCmd.pageSwitch ? { pageSwitch: pageCmd.pageSwitch } : {}),
      });
    }

    // "No, I meant the cancel button": undo the last change, redo it on the new element.
    const correction = parseCorrection(trimmed);
    if (correction) return NextResponse.json(await correct(correction, page, pages));

    // Deterministic navigation: "start the sign in page" is routing, not a
    // design decision. Resolve without spending a Jev call.
    const navMatch = utterance.trim().match(NAV_RE);
    if (navMatch && !/\b(for|with|and)\b/i.test(navMatch[1])) {
      const targetId = guessPageId(`${navMatch[1]} page`);
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
        if (applyMeta(page)) await commitPage(page);
        return NextResponse.json({
          pageId: page.pageId, spec: page, decisions: navDecisions,
          note: `On the "${targetId}" page.`, changed: false,
        });
      }
      let target = pages.find((p) => p.pageId === targetId);
      let note: string;
      if (target) {
        if (applyMeta(target)) await commitPage(target);
        note = `Switched to the "${targetId}" page.`;
      } else {
        target = emptyPage(targetId);
        applyMeta(target);
        await commitPage(target);
        note = `Started a new page: "${targetId}".`;
      }
      return NextResponse.json({
        pageId: target.pageId, spec: target, decisions: navDecisions,
        note, changed: false, pageSwitch: target.pageId,
      });
    }

    // Several commands in one utterance: apply each in order, save once (one undo step).
    const parts = splitCommands(trimmed);
    if (parts.length > 1) return NextResponse.json(await applyMany(parts, trimmed, page, pages));

    // Direct edits (move, duplicate, field details, list items, button styles)
    // are deterministic against the current page; anything else goes to Jev.
    const before = clone(page);
    const result = await applyUtterance(utterance, page, pages, askJev);
    const candidates = result.candidates;

    // Page routing: Jev said this utterance is about another page.
    if (result.pageSwitch && result.pageSwitch !== "__newpage__") {
      const target = await loadPage(result.pageSwitch);
      return NextResponse.json({
        pageId: target.pageId,
        spec: target,
        decisions: result.decisions,
        candidates,
        note: result.note,
        changed: false,
        pageSwitch: target.pageId,
      });
    }
    if (result.pageSwitch === "__newpage__") {
      const newPageId = guessPageId(utterance);
      // Never clobber an existing page that happens to share the guessed id.
      const existing = pages.find((p) => p.pageId === newPageId);
      const fresh = existing ?? emptyPage(newPageId);
      addFictionalAlert(fresh, utterance);
      const seeded = seedNewPage(utterance, fresh, result.decisions);
      await commitPage(fresh);
      const verb = existing ? `Switched to the "${newPageId}" page` : `Started a new page: "${newPageId}"`;
      return NextResponse.json({
        pageId: fresh.pageId,
        spec: fresh,
        decisions: result.decisions,
        candidates,
        note: seeded ? `${verb} and added ${seeded}.` : `${verb}.`,
        changed: seeded !== null,
        pageSwitch: fresh.pageId,
      });
    }

    if (result.changed) {
      if (result.via === "jev") addFictionalAlert(page, utterance);
      await commitPage(page);
      await remember(utterance, before, page);
    }
    return NextResponse.json({
      pageId: page.pageId,
      spec: page,
      decisions: result.decisions,
      candidates,
      note: result.note,
      changed: result.changed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
