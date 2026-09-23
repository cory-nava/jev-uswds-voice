/**
 * Conversation edits that act on the page: pronoun text edits ("change it to
 * say …") and similar. Runs before every other direct edit. Documented in
 * lib/commands-conversation.ts.
 */
import type { SpecNode } from "./spec";
import { FIELD_TYPES, TEXT_KEYS, cap, cleanSpoken, describe, lastTouched, type Handler } from "./edit-helpers";

const PRON = "(?:it|that|this|that one|this one)";

/** The prop that holds an element's visible text. */
function textProp(n: SpecNode): string | null {
  const byType: Record<string, string> = {
    Button: "label", Link: "label", Heading: "text", Text: "text", Alert: "message", SiteAlert: "message",
    Card: "title", Hero: "heading", Header: "siteName", Footer: "agencyName", Table: "caption",
  };
  if (byType[n.type]) return byType[n.type];
  if (FIELD_TYPES.includes(n.type)) return "label";
  return TEXT_KEYS.find((k) => typeof n.props[k] === "string") ?? null;
}

/** Style words mean a style edit, not new text: "change it to red", "change it to an h2". */
const STYLE_WORDS = /^(?:an?\s+)?(?:red|blue|gr[ae]y|orange|gold|yellow|cyan|teal|secondary|primary|default|outline|outlined|inverse|base|unstyled|accent[- ]?(?:cool|warm)|cool|warm|big|bigger|large|small|normal(?: size)?|required|optional|mandatory|h[1-6]|heading level \w+|level \w+|striped|borderless|compact)$/i;

/** change it to say Apply now · make that say Continue · rename it to Mobile phone · change its label to Mobile phone */
const pronounText: Handler = (u, page) => {
  const m =
    u.match(new RegExp(`^(?:change|make|set|update|switch|edit)\\s+${PRON}\\s+(?:to\\s+)?(?:say|read|says|reads)\\s+(.+)$`, "i")) ??
    u.match(new RegExp(`^(?:rename|retitle|relabel|reword|call)\\s+${PRON}\\s+(?:to\\s+|as\\s+)?(.+)$`, "i")) ??
    u.match(/^(?:change|set|update|make)\s+its\s+(?:text|label|title|wording|name|heading)\s+(?:to\s+)?(.+)$/i) ??
    u.match(new RegExp(`^(?:change|update|switch)\\s+${PRON}\\s+to\\s+(.+)$`, "i"));
  if (!m || STYLE_WORDS.test(m[1].trim())) return null;
  const node = lastTouched(page);
  const prop = node && textProp(node);
  const text = cleanSpoken(m[1]);
  if (!node || !prop || !text) return null;
  const old = node.props[prop];
  node.props[prop] = cap(text);
  return {
    kind: "text", changed: true, touched: node.id,
    note: `Changed ${node.type} ${prop}${typeof old === "string" && old ? ` "${old}"` : ""} → "${node.props[prop]}".`,
  };
};

/** change its hint to Include your area code · give it a hint that says … · add a placeholder that says … (to the field just changed) */
const pronounHint: Handler = (u, page) => {
  const m =
    u.match(/^(?:change|set|update|make)\s+(?:its|the)\s+(hint|placeholder|help text|helper text)\s+(?:to\s+)?(.+)$/i) ??
    u.match(/^(?:add|put|set)\s+(?:a|an|the)\s+(hint|placeholder|help text|helper text)\s+(?:that says|saying|that reads|reading|of)\s+(.+)$/i) ??
    u.match(new RegExp(`^give\\s+${PRON}\\s+(?:a|an)\\s+(hint|placeholder|help text|helper text)\\s+(?:that says|saying|that reads|reading|of)\\s+(.+)$`, "i"));
  if (!m) return null;
  const node = lastTouched(page, FIELD_TYPES);
  const text = cleanSpoken(m[2]);
  if (!node || !text) return null;
  const key = /placeholder/i.test(m[1]) ? "placeholder" : "hint";
  node.props[key] = key === "hint" ? cap(text) : text;
  return { kind: "field", changed: true, touched: node.id, note: `Set the ${key} on ${describe(node)} to "${node.props[key]}".` };
};

export const conversationHandlers: Handler[] = [pronounHint, pronounText];
