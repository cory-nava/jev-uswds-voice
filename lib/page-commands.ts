/**
 * Page management by voice: rename, delete, restore, duplicate, set the page
 * title, start over, list pages. Resolved before Jev (like navigation and
 * undo), never spending a Jev call. Documented in lib/commands-layout.ts.
 *
 * `parsePageCommand` is a pure, synchronous parser — it recognizes the
 * utterance and pulls out the words, but never touches the filesystem.
 * `applyPageCommand` resolves spoken page names against the real pages on
 * disk (lib/store.ts) and performs the change.
 */
import type { PageSpec } from "./spec";
import { cap, cleanSpoken, normalize } from "./edit-helpers";
import { TEMPLATES, findTemplate, pageFromTemplate } from "./templates";
import { commitPage, listPages, loadPage, pageExists, renamePageFile, restorePage as restorePageFile, trashPage } from "./store";

export interface PageCommandResult {
  /** What happened, for the log. */
  note: string;
  /** True if any page spec was written or deleted (the client refreshes its page list). */
  changed: boolean;
  /** The page the planner should show afterwards (e.g. the renamed or duplicated page). */
  pageId: string;
  /** Spec of `pageId` after the command, if it still exists. */
  spec: PageSpec | null;
  /** Set when the client should switch tabs to `pageId`. */
  pageSwitch?: string;
}

// ---------------------------------------------------------------------------
// Pure parsing
// ---------------------------------------------------------------------------

export type ParsedPageCommand =
  | { kind: "rename"; fromCurrent: boolean; fromName: string; toId: string }
  | { kind: "delete"; targetCurrent: boolean; targetName: string }
  | { kind: "restore"; targetName: string }
  | { kind: "duplicate"; fromName: string; toId: string }
  | { kind: "setTitle"; title: string }
  | { kind: "clear" }
  | { kind: "list" }
  | { kind: "fromTemplate"; templateName: string; name: string | null }
  | { kind: "listTemplates" };

/** Ids that would clash with app routes, or that look like internal/private ids. */
const RESERVED_IDS = new Set(["commands", "voice", "api"]);

export function isReservedPageId(id: string): boolean {
  return !id || RESERVED_IDS.has(id) || id.startsWith("_");
}

/** "sign up" -> "sign-up"; matches the slug style used elsewhere (see guessPageId in lib/jev.ts). */
export function slugifyPageId(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pure check + parse: does this utterance look like a page-management command? (Used by tests and by isPageCommand.) */
export function parsePageCommand(utterance: string): ParsedPageCommand | null {
  const u = normalize(utterance);

  let m = u.match(/^rename\s+(?:this|the current)\s+page\s+to\s+(.+)$/i);
  if (m) return { kind: "rename", fromCurrent: true, fromName: "", toId: slugifyPageId(m[1]) };

  m = u.match(/^rename\s+the\s+(.+?)\s+page\s+to\s+(.+)$/i);
  if (m) return { kind: "rename", fromCurrent: false, fromName: m[1].trim(), toId: slugifyPageId(m[2]) };

  if (/^delete\s+(?:this|the current)\s+page$/i.test(u)) return { kind: "delete", targetCurrent: true, targetName: "" };

  m = u.match(/^delete\s+the\s+(.+?)\s+page$/i);
  if (m) return { kind: "delete", targetCurrent: false, targetName: m[1].trim() };

  m = u.match(/^restore\s+the\s+(.+?)\s+page$/i);
  if (m) return { kind: "restore", targetName: m[1].trim() };

  m = u.match(/^duplicate\s+the\s+(.+?)\s+page\s+as\s+(.+)$/i);
  if (m) return { kind: "duplicate", fromName: m[1].trim(), toId: slugifyPageId(m[2]) };

  // "page"/"tab" required: a bare "set the title to …" usually means the heading.
  m = u.match(/^(?:set|change)\s+(?:the\s+)?(?:page|tab|browser)\s+title\s+to\s+(.+)$/i);
  if (m) return { kind: "setTitle", title: m[1].trim() };

  if (/^(?:start over|start this page over|clear this page|clear the page)$/i.test(u)) return { kind: "clear" };

  if (/^(?:what pages do i have|list my pages|what pages exist|list the pages)$/i.test(u)) return { kind: "list" };

  const fromTemplate = parseTemplateCommand(u);
  if (fromTemplate) return fromTemplate;

  return null;
}

/**
 * "create a new marketing page from the template", "make a benefits page from the marketing template",
 * "start a new page called sign up using the sign in template", "what templates are there".
 */
function parseTemplateCommand(u: string): ParsedPageCommand | null {
  if (!/\b(?:templates?|samples?|starters?)\b/i.test(u)) return null;
  if (/^(?:what|which)\s+(?:templates|samples)\b|^(?:list|show)(?:\s+me)?\s+(?:the\s+|all\s+(?:the\s+)?)?(?:templates|samples|starters)\b/i.test(u)) {
    return { kind: "listTemplates" };
  }
  if (!/^(?:create|make|start|build|add|give me|new|use|copy|set up)\b/i.test(u)) return null;
  const TEMPLATE_WORD = "(?:template|sample(?:\\s+page)?|starter)";
  // "the marketing template" names the template outright…
  const named = u.match(new RegExp(`\\b(?:from|using|based on|off|with|use|copy)\\s+(?:the\\s+|a\\s+)?([a-z][a-z ]*?)\\s+${TEMPLATE_WORD}\\b`, "i"));
  // …otherwise "a new marketing page from the template" names it as the page kind.
  const kindWord = u.match(/\b(?:a|an|another|new)\s+(?:new\s+|blank\s+|fresh\s+)*([a-z][a-z ]*?)\s+page\b/i)?.[1];
  const pageKind = kindWord && !/^(?:new|blank|fresh|another)$/i.test(kindWord) ? kindWord : undefined;
  // "from the template" has no name in it ("the" isn't a template).
  const namedTemplate = named && !/^(?:the|a|an|this|that)$/i.test(named[1]) ? named[1] : null;
  const templateName = namedTemplate ?? (pageKind && findTemplate(pageKind) ? pageKind : null);
  if (!templateName) return null;
  const called = u.match(/\b(?:called|named|titled)\s+(.+?)(?=\s+(?:from|using|based on|off|with)\b|$)/i)?.[1];
  // "make a benefits page from the marketing template": a page kind that isn't the template is the new name.
  const name = called ?? (pageKind && !findTemplate(pageKind) ? pageKind : null);
  return { kind: "fromTemplate", templateName: templateName.trim(), name: name ? cleanSpoken(name) : null };
}

/** Pure check: does this utterance look like a page-management command? (Used by tests.) */
export function isPageCommand(utterance: string): boolean {
  return parsePageCommand(utterance) !== null;
}

// ---------------------------------------------------------------------------
// Applying: resolve spoken names against the real pages on disk, then act.
// ---------------------------------------------------------------------------

function titleCaseId(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "sign in" -> the real "signin" page id, even though its slug is irregular; falls back to the plain slug. */
async function resolveExistingId(name: string): Promise<string | null> {
  const slug = slugifyPageId(name);
  if (await pageExists(slug)) return slug;
  const collapsed = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ids = (await listPages()).map((p) => p.pageId);
  const hit = ids.find((id) => id.replace(/[^a-z0-9]/g, "") === collapsed);
  return hit ?? null;
}

const fail = async (currentPageId: string, note: string): Promise<PageCommandResult> => ({
  note,
  changed: false,
  pageId: currentPageId,
  spec: await loadPage(currentPageId),
});

/** Apply a page-management command for the page currently open in the planner, or return null. */
export async function applyPageCommand(utterance: string, currentPageId: string): Promise<PageCommandResult | null> {
  const parsed = parsePageCommand(utterance);
  if (!parsed) return null;

  switch (parsed.kind) {
    case "rename": {
      const from = parsed.fromCurrent ? currentPageId : await resolveExistingId(parsed.fromName);
      const to = parsed.toId;
      if (!from) return fail(currentPageId, `No page called "${parsed.fromName}" to rename.`);
      if (isReservedPageId(to)) return fail(currentPageId, `Can't rename to "${to}" — that name is reserved.`);
      if (from === to) return fail(currentPageId, `The page is already called "${to}".`);
      if (await pageExists(to)) return fail(currentPageId, `A page called "${to}" already exists — pick another name.`);
      const renamed = await renamePageFile(from, to);
      if (!renamed) return fail(currentPageId, `Couldn't rename "${from}".`);
      return { note: `Renamed "${from}" to "${to}".`, changed: true, pageId: to, spec: renamed, pageSwitch: to };
    }

    case "delete": {
      const target = parsed.targetCurrent ? currentPageId : await resolveExistingId(parsed.targetName);
      if (!target) return fail(currentPageId, `No page called "${parsed.targetName}" to delete.`);
      const ok = await trashPage(target);
      if (!ok) return fail(currentPageId, `Couldn't delete "${target}".`);
      const note = `Deleted "${target}". Say "restore the ${target} page" to bring it back.`;
      if (target === currentPageId) {
        const remaining = await listPages();
        const next = remaining[0]?.pageId ?? "marketing";
        return { note, changed: true, pageId: next, spec: await loadPage(next), pageSwitch: next };
      }
      return { note, changed: true, pageId: currentPageId, spec: await loadPage(currentPageId) };
    }

    case "restore": {
      const target = slugifyPageId(parsed.targetName);
      // Never overwrite a live page (e.g. the sample page Reset put back).
      if (await pageExists(target)) {
        return fail(currentPageId, `A "${target}" page already exists. Rename it first ("rename the ${target} page to …"), then restore.`);
      }
      const restored = await restorePageFile(target);
      if (!restored) return fail(currentPageId, `No deleted page called "${parsed.targetName}" to restore.`);
      return { note: `Restored "${target}".`, changed: true, pageId: target, spec: restored, pageSwitch: target };
    }

    case "duplicate": {
      const from = await resolveExistingId(parsed.fromName);
      const to = parsed.toId;
      if (!from) return fail(currentPageId, `No page called "${parsed.fromName}" to duplicate.`);
      if (isReservedPageId(to)) return fail(currentPageId, `Can't use "${to}" — that name is reserved.`);
      if (await pageExists(to)) return fail(currentPageId, `A page called "${to}" already exists — pick another name.`);
      const source = await loadPage(from);
      const copy: PageSpec = {
        pageId: to,
        title: titleCaseId(to),
        nodes: JSON.parse(JSON.stringify(source.nodes)),
        nextId: source.nextId,
      };
      await commitPage(copy);
      return { note: `Duplicated "${from}" as "${to}".`, changed: true, pageId: to, spec: copy, pageSwitch: to };
    }

    case "setTitle": {
      const title = cap(cleanSpoken(parsed.title));
      if (!title) return fail(currentPageId, "Couldn't hear the new title.");
      const page = await loadPage(currentPageId);
      page.title = title;
      await commitPage(page);
      return { note: `Set the page title to "${title}".`, changed: true, pageId: currentPageId, spec: page };
    }

    case "clear": {
      const page = await loadPage(currentPageId);
      page.nodes = [];
      page.lastTouched = null;
      await commitPage(page);
      return { note: `Cleared "${currentPageId}" — say "undo" to bring it back.`, changed: true, pageId: currentPageId, spec: page };
    }

    case "fromTemplate": {
      const template = findTemplate(parsed.templateName);
      if (!template) {
        return fail(currentPageId, `No "${parsed.templateName}" template. Templates: ${TEMPLATES.map((t) => t.id).join(", ")}.`);
      }
      let id = slugifyPageId(parsed.name ?? template.id);
      if (isReservedPageId(id)) return fail(currentPageId, `Can't use "${id}" — that name is reserved.`);
      if (parsed.name && (await pageExists(id))) return fail(currentPageId, `A page called "${id}" already exists — pick another name.`);
      // Unnamed: marketing-2, marketing-3, …
      for (let n = 2; !parsed.name && (await pageExists(id)); n++) id = `${slugifyPageId(template.id)}-${n}`;
      const page = pageFromTemplate(template, id, titleCaseId(id));
      await commitPage(page);
      return {
        note: `Created "${id}" from the ${template.id} template (${template.description}).`,
        changed: true, pageId: id, spec: page, pageSwitch: id,
      };
    }

    case "listTemplates": {
      const note = `Templates: ${TEMPLATES.map((t) => `${t.id} (${t.description})`).join("; ")}. Say "create a new page from the marketing template".`;
      return { note, changed: false, pageId: currentPageId, spec: await loadPage(currentPageId) };
    }

    case "list": {
      const pages = await listPages();
      const note = pages.length
        ? `You have ${pages.length} page${pages.length === 1 ? "" : "s"}: ${pages.map((p) => p.pageId).join(", ")}.`
        : "No pages yet.";
      return { note, changed: false, pageId: currentPageId, spec: await loadPage(currentPageId) };
    }
  }
}
