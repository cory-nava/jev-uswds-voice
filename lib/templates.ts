/**
 * Page templates: the original demo pages, kept read-only in the codebase so
 * "create a new page from the marketing template" always starts from known-good
 * structure and styles, whatever has happened to the editable pages in specs/.
 */
import type { PageSpec } from "./spec";
import { clearHistory, listPages, savePage, trashPage } from "./store";
import marketing from "./templates/marketing.json";
import signin from "./templates/signin.json";
import dashboard from "./templates/dashboard.json";
import profile from "./templates/profile.json";

export interface PageTemplate {
  id: string;
  /** What the template is, for "what templates are there". */
  description: string;
  /** Spoken names that pick this template. */
  aliases: string[];
  spec: PageSpec;
}

export const TEMPLATES: PageTemplate[] = [
  { id: "marketing", description: "landing page: hero, top tasks, programs, help, footer", aliases: ["marketing", "landing", "home", "homepage", "home page"], spec: marketing as PageSpec },
  { id: "signin", description: "sign in: form, create an account, help", aliases: ["sign in", "signin", "log in", "login"], spec: signin as PageSpec },
  { id: "dashboard", description: "dashboard: side nav, action alert, applications table, progress steps", aliases: ["dashboard", "overview", "applications"], spec: dashboard as PageSpec },
  { id: "profile", description: "profile: side nav, contact form with save and cancel", aliases: ["profile", "account", "settings", "edit profile"], spec: profile as PageSpec },
];

/** "sign in", "the landing", "Marketing" → the matching template, or null. */
export function findTemplate(spoken: string): PageTemplate | null {
  const s = spoken.toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/\s+(?:page|one)$/, "").trim();
  return TEMPLATES.find((t) => t.aliases.includes(s) || t.id === s.replace(/[^a-z]/g, "")) ?? null;
}

/** A fresh, editable copy of a template as page `pageId`. */
export function pageFromTemplate(template: PageTemplate, pageId: string, title: string): PageSpec {
  const copy = JSON.parse(JSON.stringify(template.spec)) as PageSpec;
  return { ...copy, pageId, title, lastTouched: null };
}

/**
 * Reset: move every page to the trash (so "restore the … page" can bring it
 * back) and clear undo history; with `samples`, write the template pages back.
 */
export async function resetPages(mode: "samples" | "empty"): Promise<{ trashed: string[]; restored: string[] }> {
  const trashed: string[] = [];
  for (const p of await listPages()) if (await trashPage(p.pageId)) trashed.push(p.pageId);
  await clearHistory();
  const restored: string[] = [];
  if (mode === "samples") {
    for (const t of TEMPLATES) {
      await savePage(pageFromTemplate(t, t.id, t.spec.title));
      restored.push(t.id);
    }
  }
  return { trashed, restored };
}
