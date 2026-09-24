/**
 * Conversation state for the voice planner: what the last utterance on a page
 * changed (so "no, I meant the cancel button" can redo it on something else),
 * several commands in one utterance, and reading the page back as an outline.
 * Pure functions only — file I/O lives in lib/session-store.ts. Documented in
 * lib/commands-conversation.ts.
 */
import type { PageSpec, SpecNode } from "./spec";
import { applyDirectEdit } from "./edits";
import { FIELD_TYPES, PRONOUN_RE, STOP, TEXT_KEYS, allNodes, cap, nodeText, tokens } from "./edit-helpers";
import { applyJevAnswers, buildJevRequest, shortlistComponents, type Decision } from "./jev";

export { splitCommands, parseUndoCount, isStopListening, isHelpRequest, isOutlineRequest } from "./intents";

/** What the last change on a page was, for corrections. */
export interface SessionRecord {
  utterance: string;
  /** The words in `utterance` that named the element it changed ("the save button", "it"). */
  phrase: string | null;
  targetId: string | null;
  targetType: string | null;
  /** Fingerprints of the page right before and right after the change. A
   *  correction compares the current page with them to know whether the
   *  change is applied, was undone, or has been built on since. */
  before: string;
  after: string;
  at: number;
}

/** Content fingerprint of a page (nodes + title; "it" tracking ignored). FNV-1a, so it runs anywhere. */
export function fingerprint(page: PageSpec): string {
  const text = JSON.stringify({ title: page.title, nodes: page.nodes });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

/** Where the remembered change stands relative to the current page. */
export function changeState(record: SessionRecord, page: PageSpec): "applied" | "undone" | "stale" {
  const now = fingerprint(page);
  return now === record.after ? "applied" : now === record.before ? "undone" : "stale";
}

// ---------------------------------------------------------------------------
// One utterance through the normal pipeline: direct edits, then Jev
// ---------------------------------------------------------------------------

export interface StepResult {
  via: "direct" | "jev";
  changed: boolean;
  note: string;
  decisions: Decision[];
  candidates?: string[];
  pageSwitch?: string;
}

export type AskJev = (payload: unknown) => Promise<Record<string, any>>;

export const commandDecision = (choice: string, label = choice): Decision => ({ question: "command", choice, label, confidence: null });

/** Apply one utterance to `page` (mutating it): a direct edit if one matches, otherwise one Jev call. Doesn't save. */
export async function applyUtterance(utterance: string, page: PageSpec, pages: PageSpec[], ask: AskJev): Promise<StepResult> {
  const direct = applyDirectEdit(utterance, page);
  if (direct) return { via: "direct", changed: direct.changed, note: direct.note, decisions: [commandDecision(direct.kind)] };
  const candidates = shortlistComponents(utterance);
  const others = pages.map((p) => (p.pageId === page.pageId ? page : p));
  const answers = await ask(buildJevRequest(utterance, page, others));
  const result = applyJevAnswers(utterance, page, others, candidates, answers);
  return { via: "jev", ...result, candidates };
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/** The element an edit changed: the last-touched one if it changed, else the first removed, edited, or moved. From `before`. */
export function affectedNode(before: PageSpec, after: PageSpec): SpecNode | null {
  const place = (page: PageSpec) => {
    const m = new Map<string, { node: SpecNode; where: string }>();
    const walk = (list: SpecNode[], parent: string) =>
      list.forEach((n, i) => { m.set(n.id, { node: n, where: `${parent}/${i}` }); if (n.children) walk(n.children, n.id); });
    walk(page.nodes, "");
    return m;
  };
  const [a, b] = [place(before), place(after)];
  const removed: SpecNode[] = [];
  const edited: SpecNode[] = [];
  const moved: SpecNode[] = [];
  for (const [id, { node, where }] of a) {
    const now = b.get(id);
    if (!now) removed.push(node);
    else if (JSON.stringify(node.props) !== JSON.stringify(now.node.props)) edited.push(node);
    else if (where !== now.where) moved.push(node);
  }
  const all = [...removed, ...edited, ...moved];
  const touched = after.lastTouched && all.find((n) => n.id === after.lastTouched);
  if (touched) return touched;
  // A new element: for a duplicate, the original it was copied from; for a fresh add, nothing.
  const fresh = after.lastTouched && !a.has(after.lastTouched) ? b.get(after.lastTouched)?.node : null;
  if (fresh) return [...a.values()].find(({ node }) => node.type === fresh.type && textOf(node) === textOf(fresh))?.node ?? null;
  // Removing a container removes its children too: report the outermost.
  const top = removed.find((n) => !removed.some((p) => p !== n && allNodes(p.children ?? []).includes(n)));
  return top ?? edited[0] ?? moved[0] ?? null;
}

const TYPE_NOUNS = new Set([
  "button", "buttons", "field", "fields", "input", "box", "textbox", "heading", "headline", "title", "card", "cards", "link", "hero",
  "header", "footer", "table", "form", "paragraph", "alert", "list", "nav", "navigation", "menu", "section", "banner", "dropdown", "checkbox",
]);
const DETERMINERS = new Set(["the", "a", "an", "that", "this", "my", "our"]);
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9’']/g, "");

/**
 * The words in `utterance` that named `node`: the longest run of the node's
 * own words and type nouns ("the phone number field"), or a pronoun ("it").
 * Returns the exact substring, or null.
 */
export function referencePhrase(utterance: string, node: SpecNode | null): string | null {
  if (!node) return null;
  const words = [...utterance.matchAll(/\S+/g)].map((m) => ({ w: bare(m[0]), start: m.index!, end: m.index! + m[0].length }));
  const nameWords = new Set(nodeText(node).split(/[^a-z0-9]+/).filter(Boolean));
  const named = new Set(tokens(nodeText(node)));
  const fits = (w: string) => nameWords.has(w) || TYPE_NOUNS.has(w);
  let best: { from: number; to: number; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!fits(words[i].w)) continue;
    let j = i;
    while (j + 1 < words.length && fits(words[j + 1].w)) j++;
    let [from, to] = [i, j];
    while (from <= to && STOP.has(words[from].w)) from++;
    while (to >= from && STOP.has(words[to].w)) to--;
    if (from <= to) {
      const run = words.slice(from, to + 1);
      const score = run.filter((x) => named.has(x.w)).length * 2 + run.filter((x) => TYPE_NOUNS.has(x.w)).length;
      if (!best || score > best.score) best = { from, to, score };
    }
    i = j;
  }
  if (best) {
    const from = best.from > 0 && DETERMINERS.has(words[best.from - 1].w) ? best.from - 1 : best.from;
    return utterance.slice(words[from].start, words[best.to].end);
  }
  const pronoun = words.find((x) => PRONOUN_RE.test(x.w));
  return pronoun ? utterance.slice(pronoun.start, pronoun.end) : null;
}

/** Remember what `utterance` did to the page (`before` → `after`). */
export function recordFor(utterance: string, before: PageSpec, after: PageSpec): SessionRecord {
  const node = affectedNode(before, after);
  return {
    utterance: utterance.trim(),
    phrase: referencePhrase(utterance.trim(), node),
    targetId: node?.id ?? null,
    targetType: node?.type ?? null,
    before: fingerprint(before),
    after: fingerprint(after),
    at: Date.now(),
  };
}

export interface Correction {
  /** The new element reference ("the cancel button"). */
  phrase: string;
  /** "the other button": pick another element of the same type. */
  other: boolean;
  /** "no, I meant make it blue": a whole new command to run instead. */
  command?: string;
}

const CORRECTION_LEAD = /^(?:(?:oh|oops|sorry|wait|hmm|um|uh|ugh|actually|no|nope|nah|not quite)[\s,.!]+)*/i;
const COMMAND_START = /^(?:add|make|change|remove|move|set|put|rename|delete|duplicate|copy|insert|replace|update|create|give|mark|turn|sort|clear|drop|get rid of|take out|swap|switch|edit)\b/i;

/**
 * "no I meant the cancel button", "not that one, the save button",
 * "wrong one, the email field", "no, the other button", "not the save button, the cancel button".
 */
export function parseCorrection(utterance: string): Correction | null {
  const raw = utterance.trim().replace(/[.!?]+$/, "");
  const hasNo = /^(?:(?:oh|oops|sorry|wait|hmm|um|uh|ugh|actually)[\s,.!]+)*(?:no|nope|nah|not quite)\b/i.test(raw);
  const u = raw.replace(CORRECTION_LEAD, "");
  const m =
    u.match(/^i (?:meant|mean|said|wanted)\s+(.+)$/i) ??
    u.match(/^(?:not (?:that|this)(?: one)?|wrong (?:one|button|field|thing|element|card|link|heading)|the wrong (?:one|button|field|thing))[\s,.!]+(?:i (?:meant|mean|wanted)\s+)?(.+)$/i) ??
    u.match(/^not\s+(?:the\s+)?.+?[\s,]+(?:but\s+)?(?:i meant\s+)?(the\s+.+)$/i) ??
    (hasNo ? u.match(/^(the\s+.+|that other one|the other one)$/i) : null);
  if (!m) return null;
  const phrase = m[1].replace(/\s+(?:instead|please|then)$/i, "").trim();
  if (!phrase) return null;
  if (COMMAND_START.test(phrase)) return { phrase, other: false, command: phrase };
  return { phrase, other: /^(?:the|that)\s+other\b/i.test(phrase) };
}

const NOUN: Record<string, string> = { Button: "button", Card: "card", Link: "link", Heading: "heading" };
const textOf = (n: SpecNode) => TEXT_KEYS.map((k) => n.props[k]).find((v): v is string => typeof v === "string" && !!v);

/** "the other button": another element of the same type, preferring siblings, as a spoken reference. */
function otherPhrase(page: PageSpec, record: SessionRecord): string | null {
  if (!record.targetId || !record.targetType) return null;
  const all = allNodes(page.nodes);
  const parent = all.find((n) => n.children?.some((c) => c.id === record.targetId));
  const pool = [...(parent?.children ?? []), ...all].filter((n) => n.type === record.targetType && n.id !== record.targetId);
  const pick = pool.find((n) => textOf(n));
  if (!pick) return null;
  const noun = NOUN[pick.type] ?? (FIELD_TYPES.includes(pick.type) ? "field" : "");
  return `the ${textOf(pick)}${noun ? ` ${noun}` : ""}`;
}

/**
 * The previous utterance with its element reference swapped for the
 * correction's: "make the save button red" + "the cancel button" →
 * "make the cancel button red". `page` is the page as it was before the
 * previous change. Null when there's nothing to swap.
 */
export function correctedUtterance(record: SessionRecord, correction: Correction, page: PageSpec): string | null {
  if (correction.command) return correction.command;
  if (!record.phrase) return null;
  let phrase = correction.other ? otherPhrase(page, record) : correction.phrase;
  if (!phrase) return null;
  const at = record.utterance.indexOf(record.phrase);
  if (at < 0) return null;
  // "make phone number required" + "email address" keeps reading naturally either way.
  if (/^the\s/i.test(record.phrase) && !/^(?:the|a|an|that|this|my)\s/i.test(phrase)) phrase = `the ${phrase}`;
  return record.utterance.slice(0, at) + phrase + record.utterance.slice(at + record.phrase.length);
}

// ---------------------------------------------------------------------------
// Outline: read the page back
// ---------------------------------------------------------------------------

const human = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const article = (s: string) => (/^[aeiou]/i.test(s) ? "an" : "a");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function names(items: string[], max = 4): string {
  if (!items.length) return "";
  const shown = items.slice(0, max).join(", ");
  return ` (${shown}${items.length > max ? `, and ${items.length - max} more` : ""})`;
}

function section(n: SpecNode): string {
  const kids = n.children ?? [];
  const text = textOf(n);
  switch (n.type) {
    case "GovBanner":
      return "the government banner";
    case "Header": {
      const items = ((n.props.navItems as Array<{ label: string }>) ?? []).map((i) => i.label);
      return `a header${n.props.siteName ? ` for ${n.props.siteName}` : ""}${items.length ? ` with ${plural(items.length, "nav link")}${names(items)}` : ""}`;
    }
    case "Footer":
      return "the footer";
    case "Heading":
    case "Hero":
    case "Text":
      return `${human(n.type)} "${text ?? ""}"`.replace(/ ""$/, "");
    case "Form": {
      const all = allNodes(kids);
      const fields = all.filter((c) => FIELD_TYPES.includes(c.type)).map((c) => String(c.props.label ?? human(c.type)));
      const buttons = all.filter((c) => c.type === "Button").map((c) => String(c.props.label ?? "button"));
      const bits = [fields.length && `${plural(fields.length, "field")}${names(fields)}`, buttons.length && `${plural(buttons.length, "button")}${names(buttons)}`].filter(Boolean);
      return `a form${bits.length ? ` with ${bits.join(" and ")}` : " (empty)"}`;
    }
    case "CardGroup":
      return `${plural(kids.length, "card")}${names(kids.map((c) => textOf(c) ?? "card"))}`;
    case "Table": {
      const cols = (n.props.columns as string[]) ?? [];
      const rows = (n.props.rows as unknown[]) ?? [];
      return `a table with ${plural(cols.length, "column")}${names(cols)} and ${plural(rows.length, "row")}`;
    }
    case "SideNav":
      return `side navigation with ${plural(kids.length, "link")}${names(kids.map((c) => textOf(c) ?? "link"))}`;
    case "List": {
      const items = (n.props.items as string[]) ?? kids.map((c) => textOf(c) ?? "");
      return `a list with ${plural(items.length, "item")}`;
    }
    default: {
      const kind = human(n.type);
      const inside = kids.length ? ` with ${plural(kids.length, "item")}` : "";
      return `${article(kind)} ${kind}${text ? ` "${text}"` : ""}${inside}`;
    }
  }
}

/** A spoken outline of the page: "A header with 4 nav links (…), then heading "Edit your profile", then a form with …". */
export function outline(page: PageSpec): string {
  if (!page.nodes.length) return `The "${page.pageId}" page is empty.`;
  return `${cap(page.nodes.map(section).join(", then "))}.`;
}
