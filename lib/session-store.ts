/**
 * Server-side conversation state: the last change per page (for corrections)
 * in ./specs/.history/<pageId>.session.json, and multi-step undo/redo.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PageSpec } from "./spec";
import { specsDir, stepHistory } from "./store";
import { recordFor, type SessionRecord } from "./session";

const sessionDir = () => path.join(specsDir(), ".history");
const file = (pageId: string) => path.join(sessionDir(), `${pageId}.session.json`);

export async function readSession(pageId: string): Promise<SessionRecord | null> {
  try {
    return JSON.parse(await fs.readFile(file(pageId), "utf8")) as SessionRecord;
  } catch {
    return null;
  }
}

export async function writeSession(pageId: string, record: SessionRecord): Promise<void> {
  await fs.mkdir(sessionDir(), { recursive: true });
  await fs.writeFile(file(pageId), JSON.stringify(record));
}

/** Remember what an utterance just did to a page. */
export async function remember(utterance: string, before: PageSpec, after: PageSpec): Promise<void> {
  await writeSession(after.pageId, recordFor(utterance, before, after));
}

/** Step back or forward `count` times ("all" = as far as history goes). Returns the final page and how many steps were taken. */
export async function stepMany(pageId: string, direction: "undo" | "redo", count: number | "all"): Promise<{ restored: PageSpec | null; steps: number }> {
  let restored: PageSpec | null = null;
  let steps = 0;
  while (count === "all" || steps < count) {
    const next = await stepHistory(pageId, direction);
    if (!next) break;
    restored = next;
    steps++;
  }
  return { restored, steps };
}
