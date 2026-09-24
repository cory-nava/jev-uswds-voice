/**
 * Regression checks for bugs found in code review. Each case names the bug it
 * pins down. Runs on the sample pages in lib/templates/ (in memory), plus a
 * throwaway specs/ directory for the store checks.
 *
 * Usage: pnpm test:regressions
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PageSpec, SpecNode } from "../lib/spec";
import { applyDirectEdit } from "../lib/edits";
import { extractNode } from "../lib/jev";
import { changeState, recordFor } from "../lib/session";
import { TEMPLATES } from "../lib/templates";

type Case = { name: string; run: () => string | null | Promise<string | null> };
const cases: Case[] = [];
const test = (name: string, run: Case["run"]) => cases.push({ name, run });

const template = (id: string): PageSpec => JSON.parse(JSON.stringify(TEMPLATES.find((t) => t.id === id)!.spec));
const all = (nodes: SpecNode[]): SpecNode[] => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
const count = (p: PageSpec) => all(p.nodes).length;
const byLabel = (p: PageSpec, label: string) => all(p.nodes).find((n) => n.props.label === label || n.props.legend === label);
const expect = (ok: boolean, why: string) => (ok ? null : why);

// ---- 1, 2: moves must never drop elements ----
test("move above an element inside the mover keeps everything", () => {
  const p = template("profile");
  const before = count(p);
  const r = applyDirectEdit("move the form above the save button", p);
  return expect(count(p) === before && !!r && !r.changed, `nodes ${before} → ${count(p)}; result ${JSON.stringify(r)}`);
});
test("move into a container nested inside the mover keeps everything", () => {
  const p = template("profile");
  const form = all(p.nodes).find((n) => n.type === "Form")!;
  form.children!.push({ id: "sec1", type: "Section", props: { title: "Extra", variant: null }, children: [] });
  const before = count(p);
  applyDirectEdit("move the form into the extra section", p);
  return expect(count(p) === before && all(p.nodes).some((n) => n.type === "Form"), `nodes ${before} → ${count(p)}`);
});
test("a handler that bails out leaves the page untouched", () => {
  const p = template("profile");
  const snapshot = JSON.stringify(p);
  const r = applyDirectEdit("move the form above the nonexistent widget", p);
  return expect(r !== null || JSON.stringify(p) === snapshot, "page changed although no edit applied");
});

// ---- 4: options must not swallow other "add X to Y" commands ----
test("add Help to the navigation reaches the header, not the radio group", () => {
  const p = template("profile");
  const radio = byLabel(p, "How should we contact you?")!;
  const opts = JSON.stringify(radio.props.options);
  applyDirectEdit("add Help to the navigation", p);
  const header = all(p.nodes).find((n) => n.type === "Header")!;
  const nav = (header.props.navItems as Array<{ label: string }>).map((i) => i.label);
  return expect(nav.includes("Help") && JSON.stringify(radio.props.options) === opts, `nav ${nav}; radio ${JSON.stringify(radio.props.options)}`);
});
test("add a hint to phone number reaches the field", () => {
  const p = template("profile");
  applyDirectEdit("add a hint to phone number that says call us anytime", p);
  const radio = byLabel(p, "How should we contact you?")!;
  return expect(byLabel(p, "Phone number")!.props.hint === "Call us anytime" && (radio.props.options as unknown[]).length === 3,
    `hint ${byLabel(p, "Phone number")!.props.hint}`);
});
test("add a search box to the header turns on search", () => {
  const p = template("profile");
  applyDirectEdit("add a search box to the header", p);
  const header = all(p.nodes).find((n) => n.type === "Header")!;
  return expect(header.props.showSearch === true, `showSearch ${header.props.showSearch}`);
});
test("the dropdown fallback still works when the phrase names a dropdown", () => {
  const p = template("profile");
  applyDirectEdit("add fax to the radio buttons", p);
  const radio = byLabel(p, "How should we contact you?")!;
  return expect((radio.props.options as unknown[]).length === 4, `options ${JSON.stringify(radio.props.options)}`);
});

// ---- 5: alert type only when the alert is meant ----
test("make contact information required doesn't touch the site alert", () => {
  const p = template("profile");
  all(p.nodes).find((n) => n.type === "Form")!.children!.unshift({
    id: "ci", type: "Input", props: { label: "Contact information", name: "contact", type: "text", placeholder: null, hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null },
  });
  const alert = all(p.nodes).find((n) => n.type === "SiteAlert")!;
  const type = alert.props.type;
  applyDirectEdit("make contact information required", p);
  return expect(alert.props.type === type && byLabel(p, "Contact information")!.props.required === true,
    `alert type ${alert.props.type}; required ${byLabel(p, "Contact information")!.props.required}`);
});
test("make the alert a warning still changes the alert", () => {
  const p = template("dashboard");
  applyDirectEdit("make the alert an error", p);
  const alert = all(p.nodes).find((n) => n.type === "Alert")!;
  return expect(alert.props.type === "error", `type ${alert.props.type}`);
});

// ---- 6, 7: corrections know whether the remembered change is still current ----
test("a correction sees an undone change as undone, even after other redos", () => {
  const p0 = template("profile");
  const pA = template("profile");
  applyDirectEdit("make the save button red", pA);
  const pB = JSON.parse(JSON.stringify(pA)) as PageSpec;
  applyDirectEdit("make the cancel button big", pB);
  const recB = recordFor("make the cancel button big", pA, pB);
  // undo twice (→ p0), redo once (→ pA): B is not applied, and pA is B's "before".
  return expect(changeState(recB, pA) === "undone" && changeState(recB, pB) === "applied" && changeState(recB, p0) === "stale",
    `pA ${changeState(recB, pA)}, pB ${changeState(recB, pB)}, p0 ${changeState(recB, p0)}`);
});
test("a correction after start over is stale, not an undo of the clear", () => {
  const before = template("profile");
  const after = template("profile");
  applyDirectEdit("make the save button red", after);
  const rec = recordFor("make the save button red", before, after);
  const cleared = { ...after, nodes: [] };
  return expect(changeState(rec, cleared) === "stale", `state ${changeState(rec, cleared)}`);
});

// ---- 8: dictated button labels keep every word ----
const empty = (): PageSpec => ({ pageId: "t", title: "t", nodes: [], nextId: 1 });
for (const [say, label, variant] of [
  ["add a button that says read the plain language guide", "Read the plain language guide", "default"],
  ["add a button that says show more", "Show more", "default"],
  ["add a button that says contact your base office", "Contact your base office", "default"],
  ["add a big accent cool apply button", "Apply", "accent-cool"],
] as const) {
  test(`button label: ${say}`, () => {
    const { props } = extractNode("Button", say, empty());
    return expect(props.label === label && props.variant === variant, `label ${props.label}, variant ${props.variant}`);
  });
}

// ---- 3: undo after rename restores the renamed page ----
test("undo after renaming a page restores the renamed page", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "voice-specs-"));
  const previous = process.env.SPECS_DIR;
  process.env.SPECS_DIR = dir; // never the real specs/
  try {
    const store = await import("../lib/store");
    const v1 = { ...template("profile"), pageId: "draft" };
    await store.commitPage(v1);
    const v2 = JSON.parse(JSON.stringify(v1)) as PageSpec;
    applyDirectEdit("make the save button red", v2);
    await store.commitPage(v2);
    await store.renamePageFile("draft", "final");
    const undone = await store.stepHistory("final", "undo");
    const oldBack = await store.pageExists("draft");
    const save = (p: PageSpec | null) => all(p?.nodes ?? []).find((n) => n.props.label === "Save")?.props.variant;
    return expect(!!undone && undone.pageId === "final" && !oldBack && save(await store.loadPage("final")) === "default",
      `undone ${undone?.pageId}; draft recreated ${oldBack}; final save variant ${save(await store.loadPage("final"))}`);
  } finally {
    if (previous === undefined) delete process.env.SPECS_DIR;
    else process.env.SPECS_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

async function main() {
  let failures = 0;
  for (const c of cases) {
    let why: string | null;
    try {
      why = await c.run();
    } catch (err) {
      why = `threw: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (why) failures++;
    console.log(`${why ? "✗" : "✓"} ${c.name}${why ? `\n    ${why}` : ""}`);
  }
  console.log(`\n${cases.length - failures}/${cases.length} regression checks pass`);
  process.exit(failures ? 1 : 0);
}

void main();
