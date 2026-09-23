/**
 * Runs every example in lib/commands.ts through the real parsers against a
 * fixture page, so the /commands reference can't drift from the app.
 *
 *   direct  → applyDirectEdit must change the page
 *   routing → must match the navigation or undo/redo patterns
 *   text    → must yield new text, and must not be claimed by a direct edit
 *   jev     → must reach Jev (no direct edit or routing match)
 *   session → the group's own `check` decides
 *
 * A group can also add fixture content with `setup`, or replace the default
 * check for its via with `check`.
 *
 * Usage: pnpm test:commands [--verbose]
 */
import { COMMAND_GROUPS, type CheckResult } from "../lib/commands";
import { applyDirectEdit } from "../lib/edits";
import { NAV_RE, UNDO_RE, REDO_RE } from "../lib/intents";
import { renamePair, spokenText } from "../lib/jev";
import type { PageSpec } from "../lib/spec";

function fixture(): PageSpec {
  let id = 0;
  const n = (type: string, props: Record<string, unknown>, children?: PageSpec["nodes"]) =>
    ({ id: `n${++id}`, type, props, ...(children ? { children } : {}) });
  const nodes = [
    n("GovBanner", { tld: ".gov" }),
    n("Header", {
      variant: "basic", siteName: "Benefit Tracker", siteUrl: "/", logoUrl: null, logoAlt: null, showSearch: false,
      navItems: ["Home", "Programs", "Check status", "Sign in"].map((label, i) => ({ label, href: "/", current: i === 0, items: null })),
    }),
    n("Hero", { heading: "Track your benefits in one place", eyebrow: null, body: null, backgroundUrl: null }),
    n("Heading", { text: "Edit your profile", level: "h1" }),
    n("Form", { large: false }, [
      n("Input", { label: "Full name", name: "fullname", hint: "As it appears on your ID" }),
      n("DateInputGroup", { label: "Date of birth", name: "dob", hint: "For example: January 19 2000" }),
      n("Input", { label: "Phone number", name: "phone", type: "tel" }),
      n("Input", { label: "Email address", name: "email", type: "email" }),
      n("ButtonGroup", { segmented: false }, [
        n("Button", { label: "Save", variant: "default" }),
        n("Button", { label: "Cancel", variant: "secondary" }),
      ]),
    ]),
    n("CardGroup", {}, ["Apply in one place", "Check your status anytime", "Get text reminders"].map((title) => n("Card", { title }))),
    n("Table", {
      columns: ["Program", "Status", "Updated"],
      rows: [["SNAP", "Approved", "May 2"], ["Medicaid", "Pending", "Apr 28"], ["WIC", "Denied", "May 5"]],
    }),
    n("SideNav", { ariaLabel: "Side navigation" }, ["Overview", "Applications", "Documents"].map((label) => n("Link", { label, href: "/" }))),
    n("List", { variant: "unordered", items: ["Bring your ID"] }),
    n("Footer", { variant: "medium", agencyName: "Benefit Tracker", navGroups: [{ heading: null, links: [{ label: "Home", href: "/" }] }] }),
  ];
  return { pageId: "fixture", title: "fixture", nodes, nextId: id + 1 };
}

const verbose = process.argv.includes("--verbose");
const isRouting = (s: string) => NAV_RE.test(s.trim()) || UNDO_RE.test(s.trim()) || REDO_RE.test(s.trim());
let failures = 0;
let total = 0;

function defaultCheck(via: string, say: string, page: PageSpec): CheckResult {
  const direct = applyDirectEdit(say, page);
  switch (via) {
    case "direct":
      return { ok: !!direct?.changed, detail: direct ? direct.note : "no direct edit matched" };
    case "routing": {
      const ok = isRouting(say) && !direct;
      return { ok, detail: ok ? "routing match" : direct ? `claimed by direct edit: ${direct.note}` : "no routing match" };
    }
    case "text": {
      const pair = renamePair(say);
      const text = pair ? `"${pair.from}" → "${pair.to}"` : spokenText(say);
      return {
        ok: !!text && !direct && !isRouting(say),
        detail: direct ? `claimed by direct edit: ${direct.note}` : text ? `new text: ${text}` : "no new text found",
      };
    }
    case "jev":
      return {
        ok: !direct && !isRouting(say),
        detail: direct ? `claimed by direct edit: ${direct.note}` : isRouting(say) ? "claimed by routing" : "→ Jev",
      };
    default:
      return { ok: false, detail: `no check for via "${via}" — give the group a \`check\`` };
  }
}

async function main() {
  for (const group of COMMAND_GROUPS) {
    console.log(`\n${group.title}  [${group.via}]`);
    for (const ex of group.examples) {
      total++;
      const page = fixture();
      group.setup?.(page);
      let ok: boolean;
      let detail: string;
      try {
        ({ ok, detail } = group.check ? await group.check(ex.say, page) : defaultCheck(group.via, ex.say, page));
      } catch (err) {
        ok = false;
        detail = `threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (!ok) failures++;
      if (!ok || verbose) console.log(`  ${ok ? "✓" : "✗"} ${ex.say}\n      ${detail}`);
    }
    if (!verbose) console.log(`  ${group.examples.length} examples checked`);
  }

  console.log(`\n${total - failures}/${total} examples pass`);
  process.exit(failures ? 1 : 0);
}

void main();
