/**
 * Shared helpers for direct edits: utterance normalization, filler cleanup,
 * and resolving spoken references ("the save button", "phone number", "it")
 * to elements on the page. Used by lib/edits.ts and the lib/edits-*.ts modules.
 */
import type { PageSpec, SpecNode } from "./spec";

export interface DirectEdit {
  kind: string;
  changed: boolean;
  note: string;
  /** Element to remember as "it" for the next utterance (null clears it, e.g. after a remove). */
  touched?: string | null;
}

/** A direct-edit command: gets the normalized utterance, mutates `page`, or returns null to pass. */
export type Handler = (u: string, page: PageSpec) => DirectEdit | null;

// ---------------------------------------------------------------------------
// Utterance normalization + element resolution
// ---------------------------------------------------------------------------

export const LEAD =
  /^(?:(?:ok(?:ay)?|so|alright|all right|now|and|then|um|uh|hey|please|actually|also|next|great|cool|perfect|nice|good|awesome|yes|yeah|yep|right)[\s,]+|(?:can|could|would) (?:we|you)\s+|let[’']?s\s+|i(?:[’']d| would) like (?:you )?to\s+|i want (?:you )?to\s+|go ahead and\s+)+/i;

export function normalize(utterance: string): string {
  return utterance.trim().replace(/[.!?]+$/, "").replace(LEAD, "").replace(/\s+please$/i, "").trim();
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const hrefFor = (label: string) => "/" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const unquote = (s: string) => s.trim().replace(/^["'“]|["'”]$/g, "").trim();

/**
 * New text as spoken after "to": drop the filler around it. "to just be first
 * name" → "first name"; "to say Apply now instead" → "Apply now".
 */
export function cleanSpoken(text: string, opts: { literal?: boolean } = {}): string {
  let t = unquote(text).replace(/[.!?]+$/, "");
  // `literal`: the text follows "that says" / "with the heading", so a leading
  // "read" or "show" is part of it ("that says read the guide").
  const lead = opts.literal
    ? /^the (?:words?|text|phrase)\s+/i
    : /^(?:just|simply|instead|now|actually|maybe|perhaps|probably)\s+|^(?:be|say|says|read|reads|become|show|display)\s+|^the (?:words?|text|phrase|label)\s+/i;
  while (lead.test(t)) t = t.replace(lead, "");
  t = t.replace(/(?:\s+(?:instead|please|for now|thanks|thank you))+$/i, "");
  return properNouns(unquote(t));
}

const PROPER = new Map(
  [
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ].map((w) => [w, cap(w)] as [string, string]).concat([["id", "ID"], ["ids", "IDs"], ["ssn", "SSN"], ["snap", "SNAP"], ["wic", "WIC"], ["tanf", "TANF"], ["faq", "FAQ"], ["faqs", "FAQs"]]),
);

/** Dictation comes in lowercase: "may 30", "monday", "your id" → "May 30", "Monday", "your ID". */
export function properNouns(text: string): string {
  return text
    .replace(/\b[a-z]+\b/g, (w) => PROPER.get(w) ?? w)
    .replace(/\bmay(?= \d)/g, "May");
}

/** Copy that reads as a sentence gets a final period: "see where each application stands" → "…stands." */
export function sentence(text: string): string {
  const t = text.trim();
  return t.split(/\s+/).length >= 4 && !/[.!?:]$/.test(t) ? `${t}.` : t;
}

export const FIELD_TYPES = [
  "Input", "Password", "Textarea", "Select", "DateInputGroup", "Checkbox", "DatePicker", "TimePicker",
  "InputMask", "ComboBox", "FileInput", "Radio", "CharacterCount", "RangeInput",
];

/** Spoken words → component types. Order matters: specific phrases first. */
export const TYPE_WORDS: Array<[RegExp, string[]]> = [
  [/\bside ?nav(?:igation)?\b|\bsidebar\b/i, ["SideNav"]],
  // Before "buttons": "the radio buttons" names a radio group, not a Button.
  [/\bradio(?: buttons?| group| options?)?\b/i, ["Radio"]],
  [/\bcheck ?box(?:es)? group\b|\bcheck ?boxes\b/i, ["CheckboxGroup"]],
  [/\bbutton group\b/i, ["ButtonGroup"]],
  [/\bcard group\b|\bcards\b/i, ["CardGroup"]],
  [/\bhero\b/i, ["Hero"]],
  [/\b(?:gov(?:ernment)?|official) banner\b/i, ["GovBanner"]],
  [/\bsite alert\b/i, ["SiteAlert"]],
  [/\bheader\b|\bnavigation\b|\bnav\b|\bmenu\b/i, ["Header"]],
  [/\bfooter\b/i, ["Footer"]],
  [/\btable\b/i, ["Table"]],
  [/\bcard\b/i, ["Card"]],
  [/\bform\b/i, ["Form"]],
  [/\bbuttons?\b/i, ["Button"]],
  [/\bheadings?\b|\btitle\b|\bheadline\b/i, ["Heading"]],
  [/\bparagraph\b|\btext block\b/i, ["Text"]],
  [/\balert\b/i, ["Alert"]],
  [/\blist\b|\bbullets\b/i, ["List"]],
  [/\bbanner\b/i, ["GovBanner", "SiteAlert"]],
  [/\bfields?\b|\binputs?\b|\btext ?box\b|\bdropdown\b|\bcheckbox\b/i, FIELD_TYPES],
];

export const TEXT_KEYS = ["label", "legend", "text", "title", "heading", "message", "siteName", "agencyName", "caption"];
export const STOP = new Set(["the", "a", "an", "this", "that", "my", "our", "page", "section", "one", "on", "of", "in", "to", "for", "it", "all", "every", "both"]);

export function allNodes(nodes: SpecNode[]): SpecNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? allNodes(n.children) : [])]);
}

export function nodeText(n: SpecNode): string {
  return TEXT_KEYS.map((k) => n.props[k]).filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
}

export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Types named in a phrase, plus the phrase with those words removed. */
export function typesIn(phrase: string): { types: string[]; rest: string } {
  let rest = phrase;
  const types: string[] = [];
  for (const [re, ts] of TYPE_WORDS) {
    if (re.test(rest)) {
      for (const t of ts) if (!types.includes(t)) types.push(t);
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  return { types, rest };
}

/** Candidates for a spoken reference like "the save button" or "phone number", best first. */
export function candidates(page: PageSpec, phrase: string, onlyTypes?: string[]): SpecNode[] {
  const { types, rest } = typesIn(phrase);
  let allowed = types;
  if (onlyTypes) {
    allowed = types.length ? types.filter((t) => onlyTypes.includes(t)) : onlyTypes;
    if (!allowed.length) return [];
  }
  const want = tokens(rest);
  const scored = allNodes(page.nodes)
    .map((n, order) => {
      const have = new Set(tokens(nodeText(n)));
      return {
        n,
        order,
        overlap: want.filter((t) => have.has(t)).length,
        exact: want.length > 0 && nodeText(n).trim() === want.join(" "),
        typed: allowed.includes(n.type),
      };
    })
    .filter((c) => (allowed.length ? c.typed : c.overlap > 0));
  // Named something ("the save button")? Then only nodes whose text matches count.
  const pool = want.length ? scored.filter((c) => c.overlap > 0) : scored;
  return pool
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.overlap - a.overlap || a.order - b.order)
    .map((c) => c.n);
}

/** "it", "that", "this one", "the last thing" — the element most recently changed on this page. */
export const PRONOUN_RE = /^(?:it|that|this|that one|this one|them|those|these|the last (?:thing|one|change)|what i just (?:added|changed|made))$/i;

/** The last-touched element, narrowed to `onlyTypes` (checking inside it when it's a container). */
export function lastTouched(page: PageSpec, onlyTypes?: string[]): SpecNode | null {
  const id = page.lastTouched;
  if (!id) return null;
  const node = allNodes(page.nodes).find((n) => n.id === id) ?? null;
  if (!node || !onlyTypes || onlyTypes.includes(node.type)) return node;
  return allNodes(node.children ?? []).find((n) => onlyTypes.includes(n.type)) ?? null;
}

export function resolve(page: PageSpec, phrase: string, onlyTypes?: string[]): SpecNode | null {
  if (PRONOUN_RE.test(phrase.trim())) return lastTouched(page, onlyTypes);
  return candidates(page, phrase, onlyTypes)[0] ?? null;
}

/** True if `id` is somewhere inside `ancestor` (not `ancestor` itself). */
export function contains(ancestor: SpecNode, id: string): boolean {
  return allNodes(ancestor.children ?? []).some((n) => n.id === id);
}

/** The array a node lives in (top level or a parent's children) and its index. */
export function locate(page: PageSpec, id: string): { list: SpecNode[]; index: number } | null {
  const walk = (list: SpecNode[]): { list: SpecNode[]; index: number } | null => {
    const index = list.findIndex((n) => n.id === id);
    if (index >= 0) return { list, index };
    for (const n of list) {
      const hit = n.children && walk(n.children);
      if (hit) return hit;
    }
    return null;
  };
  return walk(page.nodes);
}

export function describe(n: SpecNode): string {
  const t = TEXT_KEYS.map((k) => n.props[k]).find((v) => typeof v === "string" && v);
  return t ? `${n.type} "${t}"` : n.type;
}

// ---------------------------------------------------------------------------
// Spoken lists
// ---------------------------------------------------------------------------

/** Multi-word labels to keep together when a spoken list has no commas. */
const LIST_PHRASES = [
  "frequently asked questions", "terms of service", "privacy policy", "account settings", "make a payment",
  "report a problem", "find a location", "news and events", "how it works", "check status", "case status",
  "sign in", "sign up", "sign out", "log in", "log out", "contact us", "about us", "get help", "find help",
  "apply now", "get started", "learn more", "my account", "your account", "help center", "site map",
  "what's new", "date of birth", "phone number", "email address", "full name", "first name", "last name",
  "zip code", "social security number", "not sure", "prefer not to say", "how to apply", "who can apply",
  "what to expect", "next steps", "required documents", "contact information", "in review", "under review",
  "documents needed", "phone call", "text message", "last updated", "get help", "child care", "job training",
  "food assistance", "health coverage", "housing help", "energy bills",
].map((p) => p.split(" "));

/**
 * Items from a spoken list. Commas/semicolons are trusted when present
 * ("Home, Programs, Check status"). Speech-to-text usually drops them, so
 * "home programs check status and sign in" splits on the last "and" and then
 * keeps known multi-word labels together: [home, programs, check status, sign in].
 */
export function spokenList(text: string): string[] {
  const t = unquote(text.trim().replace(/[.!?]+$/, "")).replace(/^[:\-\s]+/, "");
  if (!t) return [];
  if (/[,;]/.test(t)) {
    return t.split(/\s*[,;]\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+(?=[^,;]*$)/i).map(unquote).filter(Boolean);
  }
  const parts = t.split(/\s+(?:and|or)\s+/i);
  const last = parts.length > 1 ? parts.pop()! : null;
  const items: string[] = [];
  for (const part of parts) {
    const words = part.split(/\s+/).filter(Boolean);
    const chunk: string[] = [];
    for (let i = 0; i < words.length; ) {
      const phrase = LIST_PHRASES.filter((p) => p.every((w, k) => words[i + k]?.toLowerCase() === w)).sort((a, b) => b.length - a.length)[0];
      const n = phrase?.length ?? 1;
      chunk.push(words.slice(i, i + n).join(" "));
      i += n;
    }
    // A joining word left over outside known phrases means one item:
    // "upload a document and start a new application" (but "date of birth" is a known phrase).
    if (chunk.some((w) => /^(?:a|an|the|to|your|my|our|for|of|with|new)$/i.test(w))) items.push(part.trim());
    else items.push(...chunk);
  }
  if (last) items.push(last.trim());
  return items.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Spoken numbers
// ---------------------------------------------------------------------------

export const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
export const COUNTING = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "2", "two", "second" → 1 (zero-based); null if not a number word. */
export function spokenIndex(word: string): number | null {
  const w = word.trim().toLowerCase().replace(/(?:st|nd|rd|th)$/, (m) => (/^\d/.test(word) ? "" : m));
  if (/^\d+$/.test(w)) return Number(w) - 1;
  const i = Math.max(COUNTING.indexOf(w), ORDINALS.indexOf(w));
  return i >= 0 ? i : null;
}
