/**
 * Routing intents: page navigation and undo/redo. These aren't design
 * decisions, so the API route resolves them before (and instead of) a Jev call.
 * Documented in lib/commands.ts; checked by `pnpm test:commands`.
 */

/** Navigation verbs are routing, not design decisions — resolve them
 *  deterministically instead of spending a Jev call. Matches utterances like
 *  "start the sign in page", "okay let's go to the marketing page", or
 *  "start a new marketing page for Benefit Tracker". Leading filler is ignored. */
export const NAV_RE = new RegExp(
  "^(?:(?:ok(?:ay)?|so|alright|all right|now|and|then|um|uh|hey|please)[\\s,]+)*" +
  "(?:let[’']?s\\s+|can you\\s+|could you\\s+|please\\s+|i want to\\s+|i[’']?d like to\\s+)?" +
  "(?:start|open|go(?: back| over)? to|head(?: back| over)? to|navigate to|take me to|jump to|switch to|show me|back to|create|new)" +
  "(?: a| an| the| my)? ([a-z][a-z\\s-]*?) (?:pages?|route|screen)(?: for ([^.]+))?[.!?]?$",
  "i"
);

/** "undo", "undo that", "take that back" / "redo", "put it back" — history, not a Jev call. */
const FILLER = "^(?:(?:ok(?:ay)?|so|alright|all right|now|and|then|um|uh|hey|please|actually|wait|no)[\\s,]+)*";
export const UNDO_RE = new RegExp(FILLER + "(?:undo(?: that| it| the last (?:change|thing|step))?|take that back|revert that|never ?mind)(?: please)?[.!?]?$", "i");
export const REDO_RE = new RegExp(FILLER + "(?:redo(?: that| it)?|put it back|bring it back)(?: please)?[.!?]?$", "i");

const COUNTS: Record<string, number> = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  "a couple of": 2, "a couple": 2, "a few": 3,
};
const COUNT_WORDS = "\\d+|a couple(?: of)?|a few|" + Object.keys(COUNTS).filter((k) => !k.startsWith("a ")).join("|");

/**
 * Undo/redo with a step count: "undo", "undo the last three changes",
 * "undo that twice", "redo two times", "undo everything". Null if it isn't
 * a history command.
 */
export function parseUndoCount(utterance: string): { direction: "undo" | "redo"; count: number | "all" } | null {
  const u = utterance.trim();
  if (UNDO_RE.test(u)) return { direction: "undo", count: 1 };
  if (REDO_RE.test(u)) return { direction: "redo", count: 1 };
  const m = u.replace(/[.!?]+$/, "").match(new RegExp(FILLER + "(undo|redo)\\b(.*)$", "i"));
  if (!m) return null;
  const direction = m[1].toLowerCase() as "undo" | "redo";
  const rest = m[2]
    .replace(/\b(?:that|it|this|them|those|these|the|last|of|my|please|changes?|things?|steps?|edits?|times?|in a row|again)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!rest) return { direction, count: 1 };
  if (/^(?:everything|all|all the way(?: back)?|every ?thing i did|the whole (?:page|thing))$/.test(rest)) return { direction, count: "all" };
  const n = rest.match(new RegExp(`^(${COUNT_WORDS})$`, "i"));
  if (!n) return null;
  const count = /^\d+$/.test(n[1]) ? Number(n[1]) : COUNTS[n[1].toLowerCase()];
  return count ? { direction, count } : null;
}

const LEAD_FILLER = "^(?:(?:ok(?:ay)?|so|alright|all right|now|um|uh|hey|please|actually|and|well|jev)[\\s,]+)*";

/** "stop listening", "pause", "that's all for now": the client turns the mic off before anything is sent. */
export function isStopListening(utterance: string): boolean {
  return new RegExp(
    LEAD_FILLER +
    "(?:stop listening|stop the mic(?:rophone)?|turn off the mic(?:rophone)?|mic off|mute(?: the mic)?|pause(?: listening| the mic)?|" +
    "that[’']?s (?:all|it) for now|that[’']?s all|i[’']?m done(?: for now)?|we[’']?re done(?: for now)?|go to sleep)" +
    "(?:[\\s,]+(?:thanks|thank you|please))?[.!?]?$",
    "i"
  ).test(utterance.trim());
}

/** "what can I say", "help", "show commands": open the /commands reference. */
export function isHelpRequest(utterance: string): boolean {
  return new RegExp(
    LEAD_FILLER +
    "(?:help(?: me)?|what can i (?:say|do)|what (?:can|do) you (?:do|understand)|what (?:commands|things) can i (?:say|use)|" +
    "(?:show|open|list) (?:me )?(?:the |all the )?(?:voice )?commands(?: page| list)?|what are the commands|how does this work)" +
    "(?:[\\s,]+please)?[.!?]?$",
    "i"
  ).test(utterance.trim());
}

/** "what's on this page", "read it back", "what do I have so far": read back an outline of the page. */
export function isOutlineRequest(utterance: string): boolean {
  return new RegExp(
    LEAD_FILLER +
    "(?:can you |could you )?" +
    "(?:what[’']?s (?:on|in) (?:this|the) page|what is (?:on|in) (?:this|the) page|what[’']?s here|read (?:it|that|the page|this page|everything) back|" +
    "read back (?:the|this) page|what do (?:i|we) have(?: so far)?|what have (?:i|we) got(?: so far)?|" +
    "(?:describe|summarize|outline) (?:the|this) page|what does (?:the|this) page (?:look like|have)|give me an outline)" +
    "(?:[\\s,]+(?:so far|please))*[.!?]?$",
    "i"
  ).test(utterance.trim());
}

const VERBS = "add|make|change|remove|move|set|put|rename|delete|duplicate|copy|clone|insert|replace|update|create|give|mark|turn|sort|clear|drop|get rid of|take out|swap|switch|edit|reword|use|show|hide|include|append";
const VERB_START = new RegExp(`^(?:(?:ok(?:ay)?|so|now|also|please|let[’']?s|can you|could you|go ahead and)[\\s,]+)*(?:${VERBS})\\b`, "i");

/**
 * Several commands in one utterance, in order: split on "and then", "then",
 * "after that", sentence breaks, and on "and" only when both halves start
 * with a command verb. "make the save and cancel buttons big and red" stays whole.
 */
export function splitCommands(utterance: string): string[] {
  const clean = (s: string) => s.trim().replace(/^[\s,;.]+|[\s,;.]+$/g, "").trim();
  const parts = utterance
    .trim()
    .split(/\s*(?:[,;.]\s*)?\b(?:and then|then|after that|afterwards|and also|and)\b\s*,?\s*|\s*[;.]\s+/i);
  // Re-join at every boundary where the next piece isn't a command (e.g. "big and red").
  const seps = [...utterance.trim().matchAll(/\s*(?:[,;.]\s*)?\b(?:and then|then|after that|afterwards|and also|and)\b\s*,?\s*|\s*[;.]\s+/gi)].map((m) => m[0]);
  const out: string[] = [];
  parts.forEach((p, i) => {
    const piece = clean(p);
    if (i === 0) { out.push(piece); return; }
    const sep = seps[i - 1];
    const bareAnd = /^\s*,?\s*and\s*,?\s*$/i.test(sep);
    const splits = !!piece && VERB_START.test(piece) && (!bareAnd || VERB_START.test(out[out.length - 1]));
    if (splits && out[out.length - 1]) out.push(piece);
    else out[out.length - 1] = `${out[out.length - 1]}${sep}${p}`.trim();
  });
  return out.map(clean).filter(Boolean);
}
