/** Server-side spec store: pages persist as JSON in ./specs/*.json */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PageSpec, emptyPage } from "./spec";

/** specs/ root, resolved per call so SPECS_DIR (tests, alternate data dirs) can point elsewhere. */
export const specsDir = () => process.env.SPECS_DIR ?? path.join(process.cwd(), "specs");
const historyDir = () => path.join(specsDir(), ".history");
const trashDir = () => path.join(specsDir(), ".trash");
const trashHistoryDir = () => path.join(trashDir(), ".history");

async function ensureDir() {
  await fs.mkdir(specsDir(), { recursive: true });
}

export async function loadPage(pageId: string): Promise<PageSpec> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(specsDir(), `${pageId}.json`), "utf8");
    return JSON.parse(raw) as PageSpec;
  } catch {
    return emptyPage(pageId);
  }
}

export async function savePage(page: PageSpec): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(specsDir(), `${page.pageId}.json`), JSON.stringify(page, null, 2));
}

export async function listPages(): Promise<PageSpec[]> {
  await ensureDir();
  const files = (await fs.readdir(specsDir())).filter((f) => f.endsWith(".json"));
  const pages: PageSpec[] = [];
  for (const f of files) {
    try {
      pages.push(JSON.parse(await fs.readFile(path.join(specsDir(), f), "utf8")) as PageSpec);
    } catch {
      /* skip unreadable */
    }
  }
  return pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
}

// ---------------------------------------------------------------------------
// Undo / redo: per-page snapshot stacks in ./specs/.history/<pageId>.json
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;

interface History {
  past: PageSpec[];
  future: PageSpec[];
}

async function readHistory(pageId: string): Promise<History> {
  try {
    return JSON.parse(await fs.readFile(path.join(historyDir(), `${pageId}.json`), "utf8")) as History;
  } catch {
    return { past: [], future: [] };
  }
}

async function writeHistory(pageId: string, h: History): Promise<void> {
  await fs.mkdir(historyDir(), { recursive: true });
  await fs.writeFile(path.join(historyDir(), `${pageId}.json`), JSON.stringify(h));
}

/** Save a change to a page, recording the prior version so it can be undone. */
export async function commitPage(page: PageSpec): Promise<void> {
  const before = await loadPage(page.pageId);
  if (JSON.stringify(before) === JSON.stringify(page)) return;
  const h = await readHistory(page.pageId);
  h.past = [...h.past, before].slice(-HISTORY_LIMIT);
  h.future = [];
  await writeHistory(page.pageId, h);
  await savePage(page);
}

/** Step a page back (undo) or forward (redo). Returns the restored page, or null if there's nothing to step to. */
export async function stepHistory(pageId: string, direction: "undo" | "redo"): Promise<PageSpec | null> {
  const h = await readHistory(pageId);
  const [from, to] = direction === "undo" ? [h.past, h.future] : [h.future, h.past];
  const restored = from.pop();
  if (!restored) return null;
  to.push(await loadPage(pageId));
  await writeHistory(pageId, h);
  // Always write back to this page, whatever id an old snapshot carries.
  const page = { ...restored, pageId };
  await savePage(page);
  return page;
}

export async function historyCounts(pageId: string): Promise<{ undo: number; redo: number }> {
  const h = await readHistory(pageId);
  return { undo: h.past.length, redo: h.future.length };
}

export async function clearHistory(): Promise<void> {
  await fs.rm(historyDir(), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Page management: rename, soft-delete (trash), restore, existence checks.
// Used by lib/page-commands.ts. specs/.trash/ holds soft-deleted specs (and
// their undo history) so "restore the X page" can bring them back; it's kept
// out of git via its own .gitignore since the shared root .gitignore can't
// be edited here.
// ---------------------------------------------------------------------------


async function ensureTrashDir(): Promise<void> {
  await fs.mkdir(trashDir(), { recursive: true });
  const gitignore = path.join(trashDir(), ".gitignore");
  try {
    await fs.access(gitignore);
  } catch {
    await fs.writeFile(gitignore, "*\n!.gitignore\n");
  }
}

export async function pageExists(pageId: string): Promise<boolean> {
  try {
    await fs.access(path.join(specsDir(), `${pageId}.json`));
    return true;
  } catch {
    return false;
  }
}

/** Move a page's spec (and its undo history, if any) to a new id. */
export async function renamePageFile(fromId: string, toId: string): Promise<PageSpec | null> {
  if (!(await pageExists(fromId))) return null;
  const page = await loadPage(fromId);
  page.pageId = toId;
  await savePage(page);
  await fs.unlink(path.join(specsDir(), `${fromId}.json`));
  // Undo snapshots carry their pageId; retag them so undo after a rename
  // restores this page instead of recreating the old one.
  const h = await readHistory(fromId);
  if (h.past.length || h.future.length) {
    const retag = (s: PageSpec) => ({ ...s, pageId: toId });
    await writeHistory(toId, { past: h.past.map(retag), future: h.future.map(retag) });
  }
  for (const f of [`${fromId}.json`, `${fromId}.session.json`]) {
    await fs.rm(path.join(historyDir(), f), { force: true });
  }
  return page;
}

/** Soft-delete a page: move its spec (and undo history) into specs/.trash/. */
export async function trashPage(pageId: string): Promise<boolean> {
  if (!(await pageExists(pageId))) return false;
  await ensureTrashDir();
  await fs.rename(path.join(specsDir(), `${pageId}.json`), path.join(trashDir(), `${pageId}.json`));
  try {
    await fs.mkdir(trashHistoryDir(), { recursive: true });
    await fs.rename(path.join(historyDir(), `${pageId}.json`), path.join(trashHistoryDir(), `${pageId}.json`));
  } catch {
    /* no history to move */
  }
  return true;
}

/** Restore a soft-deleted page from specs/.trash/. Returns the restored spec, or null if nothing was trashed under that id. */
export async function restorePage(pageId: string): Promise<PageSpec | null> {
  try {
    await fs.access(path.join(trashDir(), `${pageId}.json`));
  } catch {
    return null;
  }
  await ensureDir();
  await fs.rename(path.join(trashDir(), `${pageId}.json`), path.join(specsDir(), `${pageId}.json`));
  try {
    await fs.mkdir(historyDir(), { recursive: true });
    await fs.rename(path.join(trashHistoryDir(), `${pageId}.json`), path.join(historyDir(), `${pageId}.json`));
  } catch {
    /* no history to restore */
  }
  return loadPage(pageId);
}

/** Remove specs/.trash entirely (paired with the demo reset endpoint). */
export async function clearTrash(): Promise<void> {
  await fs.rm(trashDir(), { recursive: true, force: true });
}
