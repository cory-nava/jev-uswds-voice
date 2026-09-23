/** Server-side spec store: pages persist as JSON in ./specs/*.json */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PageSpec, emptyPage } from "./spec";

const SPECS_DIR = path.join(process.cwd(), "specs");

async function ensureDir() {
  await fs.mkdir(SPECS_DIR, { recursive: true });
}

export async function loadPage(pageId: string): Promise<PageSpec> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(SPECS_DIR, `${pageId}.json`), "utf8");
    return JSON.parse(raw) as PageSpec;
  } catch {
    return emptyPage(pageId);
  }
}

export async function savePage(page: PageSpec): Promise<void> {
  await ensureDir();
  await fs.writeFile(path.join(SPECS_DIR, `${page.pageId}.json`), JSON.stringify(page, null, 2));
}

export async function listPages(): Promise<PageSpec[]> {
  await ensureDir();
  const files = (await fs.readdir(SPECS_DIR)).filter((f) => f.endsWith(".json"));
  const pages: PageSpec[] = [];
  for (const f of files) {
    try {
      pages.push(JSON.parse(await fs.readFile(path.join(SPECS_DIR, f), "utf8")) as PageSpec);
    } catch {
      /* skip unreadable */
    }
  }
  return pages.sort((a, b) => a.pageId.localeCompare(b.pageId));
}
