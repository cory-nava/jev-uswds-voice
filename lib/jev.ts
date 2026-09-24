/**
 * Jev evaluation layer (Moore's flow):
 *   1. capture the utterance
 *   2. include the current design (the page spec)
 *   3. build the evaluation questions
 *   4. ask Jev ONCE
 *   5. apply Jev's evaluations as JSON patches
 *   6. render
 *
 * Jev only answers structured Choice questions — it never generates text.
 * Literal content (headings, labels, nav items) comes from the transcript
 * itself via small deterministic extractors below.
 */
import catalogMeta from "./catalog-meta.json";
import { PageSpec, SpecNode, newId, labelNode, findNode, removeNode, CONTAINERS } from "./spec";
import { spokenButtonStyle, cleanSpoken } from "./edits";
import { spokenList, cap, hrefFor, COUNTING, spokenIndex, sentence } from "./edit-helpers";

export interface JevQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevRequest {
  state: string;
  model: string;
  questions: Record<string, JevQuestion>;
}

export interface Decision {
  question: string;
  choice: string;
  label: string;
  confidence: number | null;
}

const META = catalogMeta as Record<string, { description: string; example: unknown }>;

// ---------------------------------------------------------------------------
// Component shortlisting: keyword map first, token overlap to fill.
// ---------------------------------------------------------------------------

const KEYWORDS: Array<[RegExp, string[]]> = [
  [/hero|landing|callout|jumbotron/i, ["Hero"]],
  [/gov(ernment)? banner|official site banner/i, ["GovBanner"]],
  [/site.?alert|emergency banner/i, ["SiteAlert"]],
  [/skip (?:to )?(?:the )?main content|skip nav(?:igation)?\b/i, ["SkipNav"]],
  [/in.?page navigation|jump links?/i, ["InPageNavigation"]],
  [/header|navigation( bar)?|nav menu|menu/i, ["Header"]],
  [/footer (?:nav(?:igation)?|links|menu)/i, ["FooterNav"]],
  [/footer (?:contact|address)/i, ["FooterContact"]],
  [/footer social|social (?:links?|media)/i, ["FooterSocial"]],
  [/footer/i, ["Footer"]],
  [/feature cards?|^cards?|card grid/i, ["CardGroup", "Card"]],
  [/\bcard\b/i, ["Card"]],
  [/sign ?in|log ?in|password/i, ["Form", "Input", "Password", "Button"]],
  [/form/i, ["Form"]],
  [/\bemail\b/i, ["Input"]],
  [/input group|prefix (?:and|or)? ?suffix|dollar (?:sign|amount)|currency (?:input|field)/i, ["InputGroup"]],
  [/\binput\b|\bfield\b|textbox/i, ["Input"]],
  [/\bbuttons?\b/i, ["Button", "ButtonGroup"]],
  [/checkbox(?:es)? group|group of checkboxes|select all that apply/i, ["CheckboxGroup"]],
  [/checkbox|check ?box/i, ["Checkbox"]],
  [/radio/i, ["Radio"]],
  [/dropdown|select (a |an )?/i, ["Select"]],
  [/combo ?box/i, ["ComboBox"]],
  [/\btable\b|spreadsheet|rows? and columns/i, ["Table"]],
  [/\balert\b|notice|warning|success message|error message/i, ["Alert"]],
  [/\bheading\b|\btitle\b/i, ["Heading"]],
  [/\bparagraph\b|\btext\b|description/i, ["Text"]],
  [/\blist\b|bullet/i, ["List"]],
  [/accordion|faq|expandable/i, ["Accordion", "AccordionSection"]],
  [/modal|dialog|popup/i, ["Modal"]],
  [/side ?nav|sidebar/i, ["SideNav"]],
  [/breadcrumb/i, ["Breadcrumb"]],
  [/\blink\b/i, ["Link"]],
  [/steps?|step indicator|multi.?step|wizard/i, ["StepIndicator"]],
  [/summary|key info/i, ["SummaryBox"]],
  [/\bsearch\b/i, ["Search"]],
  [/date range|start date and end date/i, ["DateRangePicker"]],
  [/\bdate of birth\b|\bbirthday\b/i, ["DateInputGroup"]],
  [/\bdate\b/i, ["DatePicker", "DateInputGroup"]],
  [/\btime\b/i, ["TimePicker"]],
  [/\bphone\b/i, ["InputMask", "Input"]],
  [/\bzip\b|\bssn\b|social security/i, ["InputMask"]],
  [/\bfile\b|upload|attach/i, ["FileInput"]],
  [/\btextarea\b|multi.?line|message box/i, ["Textarea"]],
  [/graphic|feature grid|values/i, ["GraphicList"]],
  [/collection|news|articles?/i, ["Collection"]],
  [/tag|badge|status pill/i, ["Tag"]],
  [/tooltip/i, ["Tooltip"]],
  [/process|how it works/i, ["ProcessList"]],
  [/pagination|pages? \d/i, ["Pagination"]],
  [/icon/i, ["Icon", "IconList"]],
  [/language/i, ["LanguageSelector"]],
  [/validation|password rules/i, ["ValidationChecklist"]],
  [/character count/i, ["CharacterCount"]],
  [/range|slider/i, ["RangeInput"]],
  [/divider|separator|horizontal rule/i, ["Divider"]],
  [/grid|columns?/i, ["Grid"]],
  [/section/i, ["Section"]],
  [/prose|article body/i, ["Prose"]],
  [/video|youtube|embed/i, ["EmbedContainer"]],
  [/identifier|agency identifier/i, ["Identifier"]],
];

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
}

/** Shortlist ~6 candidate components for the Jev Choice question. */
export function shortlistComponents(utterance: string): string[] {
  const picked: string[] = [];
  for (const [re, comps] of KEYWORDS) {
    if (re.test(utterance)) {
      for (const c of comps) {
        if (META[c] && !picked.includes(c)) picked.push(c);
      }
    }
    if (picked.length >= 5) break;
  }
  // Fill by token overlap with name + description.
  const tokens = new Set(tokenize(utterance));
  const scored = Object.entries(META)
    .filter(([name]) => !picked.includes(name) && !/^(FooterNav|FooterContact|FooterSocial|AccordionSection)$/.test(name))
    .map(([name, m]) => {
      const hay = tokenize(name + " " + m.description);
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score++;
      return { name, score };
    })
    .sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (picked.length >= 7) break;
    if (s.score > 0) picked.push(s.name);
  }
  for (const fb of ["Text", "Heading", "Section"]) {
    if (picked.length < 4 && !picked.includes(fb)) picked.push(fb);
  }
  return picked.slice(0, 8);
}

// ---------------------------------------------------------------------------
// State + questions
// ---------------------------------------------------------------------------

export const PAGE_IDS = ["marketing", "signin", "dashboard", "profile"] as const;

function describePage(page: PageSpec): string {
  if (!page.nodes.length) return "(empty — nothing built yet)";
  return page.nodes.map((n) => `- ${labelNode(n)}`).join("\n");
}

function choiceLetters(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

export function buildJevRequest(utterance: string, page: PageSpec, pages: PageSpec[]): JevRequest {
  const candidates = shortlistComponents(utterance);
  const compLetters = choiceLetters(candidates.length);
  const compCriteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    compCriteria[compLetters[i]] = `${c}: ${META[c].description}`;
  });

  const targets = page.nodes.map(labelNode);
  const targetLetters = choiceLetters(targets.length + 1);
  const targetCriteria: Record<string, string> = {};
  targets.forEach((t, i) => {
    targetCriteria[targetLetters[i]] = `The existing section: ${t}`;
  });
  targetCriteria[targetLetters[targets.length]] =
    "Create something new — the speaker is not referring to any existing section.";

  const pageLetters = choiceLetters(pages.length + 1);
  const pageCriteria: Record<string, string> = {};
  pages.forEach((p, i) => {
    pageCriteria[pageLetters[i]] = `The "${p.pageId}" page${p.nodes.length ? ` (already has ${p.nodes.length} section(s))` : " (empty)"}.`;
  });
  pageCriteria[pageLetters[pages.length]] = "A brand-new page that does not exist yet.";

  const state = [
    `You are helping build a USWDS website by voice. The speaker just said:`,
    `"${utterance}"`,
    ``,
    `Current page under construction: "${page.pageId}"`,
    `Sections on this page now:`,
    describePage(page),
    ``,
    `Other pages in the site: ${pages.map((p) => `"${p.pageId}" (${p.nodes.length} sections)`).join(", ") || "(none yet)"}`,
  ].join("\n");

  return {
    state,
    model: "jev-latest",
    questions: {
      is_ui_instruction: {
        type: "choice",
        instructions: "Is the speaker asking to change the website UI, or is this something else? Judge only what they said.",
        criteria: {
          A: "UI instruction: the speaker wants to add, change, remove, or restyle something on the page.",
          B: "Not a UI instruction: a question, a remark, chatter, or content dictation not meant to change the layout.",
        },
      },
      page_intent: {
        type: "choice",
        instructions: "Which page is the speaker talking about? Match their words to the page list.",
        criteria: pageCriteria,
      },
      operation: {
        type: "choice",
        instructions: "What kind of change does the speaker want? If they are not giving a UI instruction, choose the closest anyway.",
        criteria: {
          A: "Create: add a brand-new section or element to the page.",
          B: "Replace: swap an existing section for a different component.",
          C: "Modify: change the text, props, or children of an existing section.",
          D: "Style: change visual styling (color, width, variant) of an existing section.",
          E: "Remove: delete an existing section from the page.",
        },
      },
      target: {
        type: "choice",
        instructions:
          "Which existing section does the speaker's instruction affect? Match their words to the option descriptions. " +
          "Jargon guide: 'call to action' or 'CTA' means a Button or Link that prompts the user to act (labeled Apply, Start, Find, Search, Sign in, etc.). " +
          "'hero' means the Hero banner at the top. 'menu' or 'nav' means the Header navigation. " +
          "If they describe something new that matches no option, choose the 'create something new' option.",
        criteria: targetCriteria,
      },
      placement: {
        type: "choice",
        instructions: "Where should the new or changed thing go? Only meaningful when creating.",
        criteria: {
          A: "Append at the end of the page (default for new sections).",
          B: "Prepend at the very top of the page.",
          C: "Inside the target section (for containers like forms, card groups, nav).",
          D: "Replace the target section entirely.",
          E: "Directly after the target section.",
          F: "Directly before the target section.",
        },
      },
      component: {
        type: "choice",
        instructions: "Which USWDS component best matches what the speaker asked for? Judge by the full option text, not the name alone.",
        criteria: compCriteria,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic content extraction from the transcript (Jev picks structure,
// the transcript provides the literal words).
// ---------------------------------------------------------------------------

function quotedStrings(utterance: string): string[] {
  return [...utterance.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * The spoken list attached to an utterance: text after a colon when there is
 * one ("navigation: home, programs"), otherwise text after one of the given
 * cue words ("with the navigation home programs and sign in"). Speech-to-text
 * drops colons and usually commas, so the actual splitting — trusting commas
 * when present, otherwise "and"/"or" plus known multi-word labels — is
 * `spokenList` (lib/edit-helpers.ts), shared with the direct-edit parsers.
 */
function spokenListAfter(utterance: string, ...cues: string[]): string[] {
  const colon = utterance.match(/:\s*(.+)$/);
  if (colon) return spokenList(colon[1]).map(cap);
  const m = utterance.match(new RegExp(`\\b(?:${cues.join("|")})\\b\\s*(?:of|for|are|being|with)?\\s*(.+)$`, "i"));
  return m ? spokenList(m[1]).map(cap) : [];
}

const FIELD_WORDS = "heading|headline|title|text|message|label|body|body text|description|subheading|tagline|eyebrow|content|items|options|steps|columns|links|sections";

/**
 * Speech has no quotes, so literal copy comes from phrasing:
 * "with the heading X and the text Y" → fieldText(u, ["heading"]) = X.
 */
function fieldText(utterance: string, names: string[]): string | null {
  const m = utterance.match(new RegExp(
    `\\b(?:with|and|plus)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:${names.join("|")})\\s+(?:of\\s+|that says\\s+|saying\\s+)?(.+?)(?=\\s+(?:and|with|plus)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:${FIELD_WORDS})\\b|$)`, "i"));
  const text = m && cleanSpoken(m[1], { literal: true });
  return text ? cap(text) : null;
}

const maybeSentence = (t: string | null): string | null => (t ? sentence(t) : null);

/** "… that says X", "… saying X", "… called X", "… titled X" → X. */
function saysText(utterance: string): string | null {
  const m = utterance.match(/\b(?:that says|which says|saying|that reads|reading|with the words|called|titled|named|labeled|labelled)\s+(.+)$/i);
  const text = m && cleanSpoken(m[1], { literal: true });
  return text ? cap(text) : null;
}

/** Words that describe a component rather than name it ("a required text field"). */
const NOT_A_LABEL = new Set(["new", "simple", "basic", "required", "optional", "text", "big", "small", "large", "another", "single", "multi", "multiple"]);

/**
 * A field label from the utterance: "… for X" ("a dropdown for state with options …"),
 * else the words before the component noun ("a state dropdown", "a start date picker").
 */
function forLabel(utterance: string): string | null {
  const m = utterance.match(/\bfor\s+(?:an?\s+|the\s+|your\s+)?([a-z][a-z0-9 ]*?)(?=\s+(?:with|that|which|where|and then)\b|[,.!?]|$)/i);
  const words = m?.[1].trim().split(/\s+/) ?? [];
  if (words.length && words.length <= 5) return cap(words.join(" "));
  const before = utterance.match(/\b(?:an?|the|another)\s+([a-z][a-z0-9 ]{0,40}?)\s+(?:dropdown|drop down|select|combo ?box|date range picker|date picker|time picker|picker|field|input|text ?box|text ?area|radio buttons?|radio group|checkbox(?:es| group)?|slider|range|file upload|upload|search box|character count)\b/i);
  const named = before?.[1].split(/\s+/).filter((w) => !NOT_A_LABEL.has(w.toLowerCase())) ?? [];
  return named.length && named.length <= 4 ? cap(named.join(" ")) : null;
}

/** A `value`-style slug ("not sure" → "not-sure"), distinct from `slug`'s hrefs. */
function valueOf(s: string): string {
  return hrefFor(s).slice(1) || "option";
}

/** First number mentioned — digits or a small counting word — else `fallback`. */
function spokenCount(utterance: string, fallback: number): number {
  const digit = utterance.match(/\b(\d+)\b/);
  if (digit) return parseInt(digit[1], 10);
  const words = utterance.toLowerCase().split(/[^a-z]+/);
  const idx = words.map((w) => COUNTING.indexOf(w)).find((i) => i >= 0);
  return idx !== undefined ? idx + 1 : fallback;
}

function slug(s: string): string {
  return "/" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fieldNode(kind: string, label: string, page: PageSpec): SpecNode {
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const pretty = cap(label);
  if (/date of birth|birthday/i.test(label)) {
    return { id: newId(page), type: "DateInputGroup", props: { label: "Date of birth", name: "dob", hint: "For example: January 19 2000", required: null, monthValue: null, dayValue: null, yearValue: null } };
  }
  if (/password/i.test(label)) {
    return { id: newId(page), type: "Password", props: { label: "Password", name: "password", hint: null, value: null, required: null, checks: null, validateOn: null } };
  }
  if (/phone/i.test(label)) {
    return { id: newId(page), type: "Input", props: { label: "Phone number", name: "phone", type: "tel", placeholder: "(555) 123-4567", hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null } };
  }
  if (/email/i.test(label)) {
    return { id: newId(page), type: "Input", props: { label: "Email address", name: "email", type: "email", placeholder: null, hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null } };
  }
  return { id: newId(page), type: kind, props: { label: pretty, name, type: "text", placeholder: null, hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null } };
}

/** Field mentions for forms: colon lists first ("fields: a, b"), then
 *  "fields for a, b and c", then a bare "an email input and a password input". */
function fieldList(utterance: string): string[] {
  const colon = utterance.match(/:\s*(.+)$/);
  if (colon) return spokenList(colon[1]);
  const fm = utterance.match(/fields?\s+(?:for\s+)?(.+)$/i);
  const src = fm
    ? fm[1]
    : utterance.replace(/^(add|create|make|put|include)\s+/i, "").replace(/^(a|an|the)\s+/i, "");
  const parts = spokenList(src)
    .map((s) => s.replace(/^(an?|the)\s+/i, "").replace(/\s+(inputs?|fields?)$/i, "").trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 6 || parts.some((p) => p.split(/\s+/).length > 4)) return [];
  return parts;
}

/** Build props + children for a new node of `component`, from the utterance. */
export function extractNode(component: string, utterance: string, page: PageSpec): { props: Record<string, unknown>; children?: SpecNode[] } {
  const q = quotedStrings(utterance);
  const said = saysText(utterance);
  const forMatch = utterance.match(/for ([A-Z][\w ]+?)(?:,|\.|$)/);
  const opts = (list: string[]) => list.map((s) => ({ label: cap(s), value: valueOf(s), hint: null }));

  switch (component) {
    case "Hero":
      return { props: { heading: q[0] ?? fieldText(utterance, ["heading", "headline", "title"]) ?? said ?? "Welcome", eyebrow: fieldText(utterance, ["eyebrow", "tagline"]), body: q[1] ?? maybeSentence(fieldText(utterance, ["text", "body", "body text", "description", "subheading"])), backgroundUrl: null, ariaLabel: "Introduction" } };
    case "GovBanner":
      return { props: { tld: ".gov", expanded: null } };
    case "SiteAlert":
      return { props: { heading: q[0] ?? fieldText(utterance, ["heading", "title"]) ?? "Demo site", message: q[1] ?? fieldText(utterance, ["message", "text"]) ?? said ?? "This is a fictional demonstration service.", type: "info", slim: null } };
    case "Header": {
      const items = spokenListAfter(utterance, "navigation", "nav items", "menu items", "menu");
      const navItems = items.length
        ? items.map((label, i) => ({ label: cap(label), href: label.toLowerCase().includes("sign") ? "/signin" : slug(label), current: /^home$/i.test(label) && i === 0, items: null }))
        : [{ label: "Home", href: "/", current: true, items: null }];
      return { props: { variant: "basic", siteName: forMatch?.[1]?.trim() ?? q[0] ?? "Benefit Tracker", siteUrl: "/", logoUrl: null, logoAlt: null, navItems, showSearch: false } };
    }
    case "Footer": {
      const links = spokenListAfter(utterance, "links", "footer links");
      return {
        props: {
          variant: /slim/i.test(utterance) ? "slim" : /big/i.test(utterance) ? "big" : "medium",
          agencyName: forMatch?.[1]?.trim() ?? q[0] ?? "Benefit Tracker",
          agencyUrl: "/", logoUrl: null, logoAlt: null,
          navGroups: [{ heading: null, links: (links.length ? links : ["Home", "Help"]).map((l) => ({ label: cap(l), href: slug(l) })) }],
          contactHeading: null, contactInfo: null, socialLinks: null, returnToTop: true,
        },
      };
    }
    case "FooterNav": {
      const labels = spokenListAfter(utterance, "links", "nav", "navigation");
      const list = labels.length ? labels : ["Home", "About"];
      return { props: {}, children: list.map((l) => ({ id: newId(page), type: "Link", props: { label: cap(l), href: slug(l), external: null, variant: "nav" } })) };
    }
    case "FooterContact": {
      const lines = spokenListAfter(utterance, "contact", "address");
      const list = lines.length ? lines : ["1-800-555-0100", "info@agency.gov"];
      return { props: { heading: forLabel(utterance) ?? "Contact us" }, children: list.map((t) => ({ id: newId(page), type: "Text", props: { text: t, variant: "body" } })) };
    }
    case "FooterSocial": {
      const labels = spokenListAfter(utterance, "social", "links");
      const list = labels.length ? labels : ["Facebook", "Twitter"];
      return { props: {}, children: list.map((l) => ({ id: newId(page), type: "Link", props: { label: cap(l), href: `https://${valueOf(l)}.com`, external: true, variant: null } })) };
    }
    case "CardGroup": {
      const cards = spokenListAfter(utterance, "cards", "card group");
      const list = cards.length ? cards : q.length ? q : ["Feature one", "Feature two", "Feature three"];
      return { props: {}, children: list.map((t) => ({ id: newId(page), type: "Card", props: { title: cap(t), description: null, headerFirst: null, mediaUrl: null, mediaAlt: null, flag: null } })) };
    }
    case "Card":
      return { props: { title: q[0] ?? said ?? fieldText(utterance, ["title", "heading"]) ?? forLabel(utterance) ?? "Card", description: q[1] ?? maybeSentence(fieldText(utterance, ["description", "text", "body"])), headerFirst: null, mediaUrl: null, mediaAlt: null, flag: null } };
    case "Form": {
      const fields = fieldList(utterance);
      const list = fields.length ? fields : ["Full name", "Email address"];
      return { props: { large: false }, children: list.map((f) => fieldNode("Input", f, page)) };
    }
    case "Input": {
      const base = { placeholder: null, hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null };
      // Judge the field type from the words before the spoken label ("a text input called case number" isn't a number field).
      const kind = said ? utterance.slice(0, utterance.toLowerCase().lastIndexOf(said.toLowerCase())) : utterance;
      const input = (fallback: string, type: string) => {
        const label = q[0] ?? said ?? forLabel(kind) ?? fallback;
        return { props: { label, name: valueOf(label), type, ...base } };
      };
      if (/email/i.test(kind)) return input("Email address", "email");
      if (/phone/i.test(kind)) return input("Phone number", "tel");
      if (/\bnumber\b|\bnumeric\b/i.test(kind)) return input("Number", "number");
      if (/\burl\b|website address/i.test(kind)) return input("Website", "url");
      return input("Text input", "text");
    }
    case "Password":
      return { props: { label: q[0] ?? "Password", name: "password", hint: null, value: null, required: null, checks: null, validateOn: null } };
    case "Button": {
      const rawLabel = q[0] ?? said ?? utterance.match(/(?:add|make|put)\s+(?:a\s+|an\s+)?(.+?)\s+button/i)?.[1]?.trim() ?? "Submit";
      // Style words count only outside a dictated label: "a button that says read the plain
      // language guide" is a default button, and its label keeps every word.
      const dictated = q[0] ?? said;
      const styleText = dictated && said ? utterance.slice(0, utterance.toLowerCase().lastIndexOf(said.toLowerCase())) : utterance;
      const { variant, size } = spokenButtonStyle(styleText);
      const label = (dictated ? rawLabel : spokenButtonStyle(rawLabel).label) || "Submit";
      return { props: { label: cap(label), variant, size, disabled: false, type: "button" } };
    }
    case "ButtonGroup": {
      const labels = spokenListAfter(utterance, "buttons", "button group");
      const list = labels.length ? labels : q.length ? q : ["Save", "Cancel"];
      return {
        props: { segmented: false },
        children: list.map((l, i) => ({
          id: newId(page), type: "Button",
          props: { label: cap(l), variant: i === 0 ? "default" : "outline", disabled: false, type: "button" },
        })),
      };
    }
    case "Checkbox":
      return { props: { label: q[0] ?? said ?? "Checkbox", name: "checkbox", hint: null, checked: /check(ed)?( by default)?|default/i.test(utterance) || null, tile: null, checks: null, validateOn: null } };
    case "CheckboxGroup": {
      const list = spokenListAfter(utterance, "options", "choices");
      return { props: { legend: forLabel(utterance) ?? q[0] ?? "Select all that apply", name: "options", options: opts(list.length ? list : ["Option one", "Option two"]), tile: null, values: null } };
    }
    case "Radio": {
      const list = spokenListAfter(utterance, "options", "choices");
      return { props: { legend: forLabel(utterance) ?? q[0] ?? "Select one", name: "option", options: opts(list.length ? list : ["Yes", "No"]), tile: null, value: null, checks: null, validateOn: null } };
    }
    case "Alert": {
      const type = /success/i.test(utterance) ? "success" : /error/i.test(utterance) ? "error" : /warning/i.test(utterance) ? "warning" : /emergency/i.test(utterance) ? "emergency" : "info";
      return { props: { heading: q.length > 1 ? q[0] : fieldText(utterance, ["heading", "title"]), message: q[1] ?? q[0] ?? maybeSentence(fieldText(utterance, ["message", "text"]) ?? said) ?? "Alert message.", type, slim: false, noIcon: false } };
    }
    case "Table": {
      const columns = spokenListAfter(utterance, "columns", "column");
      const list = columns.length ? columns : ["Column one", "Column two", "Column three"];
      return { props: { columns: list, rows: [], caption: null, borderless: false, striped: true, compact: false, scrollable: null } };
    }
    case "Heading": {
      const level = page.nodes.some((n) => n.type === "Heading") ? "h2" : "h1";
      return { props: { text: q[0] ?? said ?? fieldText(utterance, ["text", "title"]) ?? "Page title", level } };
    }
    case "Text":
      return { props: { text: q[0] ?? maybeSentence(said ?? fieldText(utterance, ["text", "content"])) ?? "Supporting text.", variant: /lead/i.test(utterance) ? "lead" : "body" } };
    case "SideNav": {
      const links = spokenListAfter(utterance, "links", "side nav");
      const list = links.length ? links : ["Overview"];
      return { props: { ariaLabel: "Side navigation" }, children: list.map((l) => ({ id: newId(page), type: "Link", props: { label: cap(l), href: slug(l), external: null, variant: null } })) };
    }
    case "Tag":
      return { props: { text: q[0] ?? said ?? "New", big: false } };
    case "SummaryBox": {
      const list = spokenListAfter(utterance, "items", "key information", "information");
      return { props: { heading: q[0] ?? fieldText(utterance, ["heading", "title"]) ?? said ?? "Key information", items: list.length ? list : ["Item one", "Item two"] } };
    }
    case "StepIndicator": {
      // The "currently on …" clause names the current step; it isn't one of the steps.
      const named = spokenListAfter(utterance.replace(/,?\s*\b(?:currently|now)\s+(?:on|at)\b.*$/i, ""), "steps");
      const steps = named.length ? named : Array.from({ length: spokenCount(utterance, 3) }, (_, i) => `Step ${i + 1}`);
      // "currently on in review", "on step two"
      const on = utterance.match(/\b(?:currently on|currently at|on|at)\s+(?:step\s+)?([a-z0-9 ]+?)(?=\s+(?:with|and)\b|[,.]|$)/i)?.[1];
      const byName = on ? steps.findIndex((s) => s.toLowerCase() === on.toLowerCase()) : -1;
      const byNumber = on ? spokenIndex(on) : null;
      const currentStep = byName >= 0 ? byName + 1 : byNumber !== null && byNumber < steps.length ? byNumber + 1 : 1;
      return { props: { steps, currentStep, counters: null, centered: null, noLabels: null } };
    }
    case "GraphicList": {
      const heads = spokenListAfter(utterance, "items", "values", "features");
      const list = heads.length ? heads : q.length ? q : ["Feature"];
      return { props: { heading: forLabel(utterance), items: list.map((t) => ({ imageUrl: null, imageAlt: null, heading: cap(t), content: `A short description of ${t.toLowerCase()}.` })) } };
    }
    case "Select": {
      const list = spokenListAfter(utterance, "options", "choices");
      const label = forLabel(utterance) ?? q[0] ?? "Select";
      return { props: { label, name: valueOf(label), options: list.length ? list : ["Option one", "Option two"], placeholder: null, hint: null, value: null, required: null, checks: null, validateOn: null } };
    }
    case "ComboBox": {
      const list = spokenListAfter(utterance, "options", "choices");
      const label = forLabel(utterance) ?? q[0] ?? "Select";
      return { props: { label, name: valueOf(label), options: list.length ? list : ["Option one", "Option two"], placeholder: "- Select -", hint: null, value: null, required: null, checks: null, validateOn: null } };
    }
    case "Textarea": {
      const label = q[0] ?? forLabel(utterance) ?? "Message";
      return { props: { label, name: valueOf(label), placeholder: null, hint: null, rows: 4, value: null, required: null, checks: null, validateOn: null } };
    }
    case "DateInputGroup":
      return { props: { label: q[0] ?? "Date of birth", name: "dob", hint: "For example: January 19 2000", required: null, monthValue: null, dayValue: null, yearValue: null } };
    case "DatePicker": {
      const label = forLabel(utterance) ?? q[0] ?? "Date";
      return { props: { label: cap(label), name: valueOf(label), hint: "mm/dd/yyyy", value: null, minDate: null, maxDate: null, required: null, checks: null, validateOn: null } };
    }
    case "DateRangePicker":
      return { props: { startLabel: "Start date", endLabel: "End date", startName: "start_date", endName: "end_date", hint: "mm/dd/yyyy", startValue: null, endValue: null, minDate: null, maxDate: null, required: null } };
    case "TimePicker": {
      const label = forLabel(utterance) ?? q[0] ?? "Appointment time";
      return { props: { label: cap(label), name: valueOf(label), hint: "Select a time", value: null, minTime: null, maxTime: null, step: 30, required: null } };
    }
    case "InputMask": {
      const preset = /zip.?\+.?4/i.test(utterance) ? "zip+4" : /\bzip\b/i.test(utterance) ? "zip" : /ssn|social security/i.test(utterance) ? "ssn" : "phone";
      const HINTS: Record<string, string> = { phone: "(___) ___-____", zip: "_____", "zip+4": "_____-____", ssn: "___-__-____" };
      const LABELS: Record<string, string> = { phone: "Phone number", zip: "ZIP code", "zip+4": "ZIP+4 code", ssn: "Social security number" };
      return { props: { label: LABELS[preset], name: preset.replace("+", "plus"), preset, pattern: null, hint: HINTS[preset], value: null, required: null, checks: null, validateOn: null } };
    }
    case "FileInput": {
      const label = forLabel(utterance) ?? q[0] ?? "Upload document";
      return { props: { label: cap(label), name: "document", hint: "Accepted formats: PDF, DOC", accept: ".pdf,.doc,.docx", multiple: /multiple|several|more than one/i.test(utterance), required: null } };
    }
    case "Search":
      return { props: { label: null, placeholder: q[0] ?? forLabel(utterance) ?? "Search...", value: null, size: "medium" } };
    case "RangeInput": {
      const label = forLabel(utterance) ?? q[0] ?? "Select a value";
      return { props: { label: cap(label), name: valueOf(label), min: 0, max: 100, step: null, value: null } };
    }
    case "CharacterCount": {
      const label = forLabel(utterance) ?? q[0] ?? "Brief description";
      return { props: { label: cap(label), name: valueOf(label), maxLength: 150, hint: "Enter a short summary", value: null, multiline: /textarea|multi.?line|paragraph/i.test(utterance), rows: 4, required: null, checks: null, validateOn: null } };
    }
    case "InputGroup": {
      const label = forLabel(utterance) ?? q[0] ?? "Amount";
      const dollar = /dollar|price|cost|\$/i.test(utterance);
      return { props: { label: cap(label), name: valueOf(label), type: dollar ? "number" : "text", prefix: dollar ? "$" : null, suffix: dollar ? ".00" : null, placeholder: null, hint: null, value: null, required: null, disabled: null, checks: null, validateOn: null } };
    }
    case "List": {
      const list = spokenListAfter(utterance, "items", "list");
      const variant = /ordered|numbered/i.test(utterance) ? "ordered" : /unstyled|no bullets?/i.test(utterance) ? "unstyled" : "unordered";
      return { props: { items: list.length ? list : q.length ? q : ["Item one", "Item two"], variant } };
    }
    case "ValidationChecklist": {
      const list = spokenListAfter(utterance, "requirements", "items", "checklist");
      return { props: { heading: q[0] ?? "Password must contain:", items: (list.length ? list : ["At least 12 characters", "At least one number"]).map((l) => ({ label: cap(l), checked: false })) } };
    }
    case "Divider":
      return { props: {} };
    case "Grid":
      return { props: { columns: Math.min(12, Math.max(1, spokenCount(utterance, 2))), gap: "md" } };
    case "Section": {
      const variant = /dark/i.test(utterance) ? "dark" : /light/i.test(utterance) ? "light" : null;
      return { props: { title: q[0] ?? forLabel(utterance), text: q[1] ?? null, variant } };
    }
    case "Prose":
      return { props: { element: "article" }, children: [{ id: newId(page), type: "Text", props: { text: q[0] ?? said ?? fieldText(utterance, ["text", "content"]) ?? "Supporting text.", variant: "body" } }] };
    case "Accordion": {
      const named = spokenListAfter(utterance, "sections");
      const titles = named.length ? named : q.length ? q : ["First section", "Second section"];
      const children = titles.map((t) => ({
        id: newId(page), type: "AccordionSection",
        props: { title: cap(t), expanded: false },
        children: [{ id: newId(page), type: "Text", props: { text: `More about ${t.toLowerCase()}.`, variant: "body" } }],
      }));
      return { props: { bordered: /border/i.test(utterance) }, children };
    }
    case "AccordionSection": {
      const title = q[0] ?? forLabel(utterance) ?? "Section title";
      return { props: { title: cap(title), expanded: false }, children: [{ id: newId(page), type: "Text", props: { text: "Section content.", variant: "body" } }] };
    }
    case "Pagination":
      return { props: { totalPages: spokenCount(utterance, 10), page: 1, ariaLabel: null } };
    case "SkipNav":
      return { props: { href: "#main-content", label: q[0] ?? "Skip to main content" } };
    case "LanguageSelector": {
      const LANGS: Record<string, string> = { english: "en", spanish: "es", french: "fr", chinese: "zh", vietnamese: "vi", korean: "ko", arabic: "ar", tagalog: "tl", russian: "ru", haitian: "ht" };
      const names = spokenListAfter(utterance, "languages", "language");
      const list = names.length ? names : ["English", "Spanish"];
      const languages = list.map((n) => {
        const code = LANGS[n.toLowerCase()] ?? valueOf(n).slice(0, 2);
        return { label: cap(n), href: `/${code}`, lang: code, localLabel: null };
      });
      return { props: { languages, currentLang: languages[0]?.lang ?? "en" } };
    }
    case "Link": {
      const url = utterance.match(/https?:\/\/[^\s"'<>]+/)?.[0];
      const label = q[0] ?? said ?? forLabel(utterance) ?? "Learn more";
      return { props: { label: cap(label), href: url ?? slug(label), external: !!url, variant: null } };
    }
    case "InPageNavigation": {
      const list = spokenListAfter(utterance, "sections", "navigation", "page");
      const labels = list.length ? list : ["Overview", "Requirements", "How to apply"];
      return {
        props: { heading: q[0] ?? "On this page" },
        children: labels.map((l) => ({ id: newId(page), type: "Link", props: { label: cap(l), href: `#${valueOf(l)}`, external: null, variant: null } })),
      };
    }
    case "Breadcrumb": {
      const list = spokenListAfter(utterance, "breadcrumb", "trail", "path");
      const labels = list.length ? list : ["Home", "Current page"];
      return {
        props: {},
        children: labels.map((l, i) => ({ id: newId(page), type: "Link", props: { label: cap(l), href: i === labels.length - 1 ? "#" : slug(l), external: null, variant: null } })),
      };
    }
    case "Identifier": {
      const agencyName = forMatch?.[1]?.trim() ?? q[0] ?? "U.S. Department of Example";
      return {
        props: {
          domain: "agency.gov", agencyName, agencyUrl: "/", logoUrl: null, logoAlt: null, disclaimer: null,
          links: [
            { label: "About agency.gov", href: "/about" },
            { label: "Accessibility statement", href: "/accessibility" },
            { label: "Privacy policy", href: "/privacy" },
          ],
          showUsagov: true,
        },
      };
    }
    case "Collection": {
      const heads = spokenListAfter(utterance, "items", "articles", "collection");
      const list = heads.length ? heads : q.length ? q : ["Article one", "Article two"];
      return { props: { items: list.map((h) => ({ heading: cap(h), href: null, description: null, date: null, dateLabel: null, tags: null, thumbnailUrl: null, thumbnailAlt: null })) } };
    }
    case "IconList": {
      const list = spokenListAfter(utterance, "items", "requirements", "list");
      const contents = list.length ? list : q.length ? q : ["Requirement one", "Requirement two"];
      return { props: { title: forLabel(utterance), size: null, items: contents.map((c) => ({ icon: "check_circle", content: cap(c), color: null })) } };
    }
    case "Tooltip": {
      const label = forLabel(utterance) ?? "More info";
      return { props: { label: cap(label), content: q[0] ?? said ?? "Additional information.", position: "top" } };
    }
    case "ProcessList": {
      const heads = spokenListAfter(utterance, "steps", "process");
      const list = heads.length ? heads : ["Apply", "Review", "Decision"];
      return { props: { items: list.map((h) => ({ heading: cap(h), content: `Details about the ${h.toLowerCase()} step.` })) } };
    }
    case "Icon": {
      const ICONS: Record<string, string> = { check: "check", close: "close", search: "search", warning: "warning", error: "error", info: "info", arrow: "arrow_forward", star: "star" };
      const found = Object.keys(ICONS).find((k) => new RegExp(`\\b${k}\\b`, "i").test(utterance));
      return { props: { name: found ? ICONS[found] : "info", size: "md", color: null, ariaLabel: null } };
    }
    case "Modal": {
      const heading = q[0] ?? fieldText(utterance, ["heading", "title"]) ?? said ?? "Are you sure?";
      return { props: { heading, description: q[1] ?? fieldText(utterance, ["description", "text", "message"]) ?? "This action cannot be undone.", openPath: `/modal/${valueOf(heading)}`, large: false } };
    }
    case "EmbedContainer": {
      const url = utterance.match(/https?:\/\/[^\s"'<>]+/)?.[0];
      return { props: { src: url ?? "https://www.youtube.com/embed/example", title: q[0] ?? forLabel(utterance) ?? "Embedded video", ratio: "16x9" } };
    }
    default:
      return { props: {} };
  }
}

/** Which prop holds the visible text for simple text-bearing components. */
const TEXT_PROP: Record<string, string> = {
  Button: "label", Link: "label", Heading: "text", Text: "text", Alert: "message", SiteAlert: "message", Card: "title",
};

const EDIT_RE = /^(?:(?:ok(?:ay)?|so|now|and|please|all right|alright|can you|could you|can we|let[’']?s)[\s,]+)*(?:change|update|edit|rename|set|reword|fix|make)\b/i;

/** Props that hold visible, speakable text on any component. */
const TEXT_PROPS = ["label", "text", "title", "heading", "message", "eyebrow", "body", "hint", "placeholder", "description", "siteName", "agencyName"];

/** "change full name to (be|say) full legal name", "… from full name to full legal name" → old + new text. */
export function renamePair(utterance: string): { from: string; to: string } | null {
  const tail = "\\s+(?:to|with|into)\\s+(?:say\\s+|read\\s+|be\\s+|the words?\\s+)?(.+?)[.!?]*$";
  const m =
    utterance.match(new RegExp("\\bfrom\\s+(.+?)" + tail, "i")) ??
    utterance.match(new RegExp("\\b(?:change|rename|update|replace|switch|edit|reword)\\s+(.+?)" + tail, "i"));
  if (!m) return null;
  const from = m[1]
    .replace(/^(?:the|a|an|that|this)\s+/i, "")
    .replace(/\s+(?:field|input|label|text|button|heading|link|box)$/i, "")
    .replace(/^["'“]|["'”]$/g, "")
    .trim();
  const to = cleanSpoken(m[2]);
  return from && to ? { from, to } : null;
}

/** Find the node + prop whose text equals `from` (case-insensitive), preferring `scope`. */
function findByText(page: PageSpec, from: string, scope: SpecNode | null): { node: SpecNode; prop: string } | null {
  const want = from.toLowerCase();
  const search = (nodes: SpecNode[]) => {
    for (const n of allNodes(nodes)) {
      for (const prop of TEXT_PROPS) {
        const v = n.props[prop];
        if (typeof v === "string" && v.trim().toLowerCase() === want) return { node: n, prop };
      }
    }
    return null;
  };
  return (scope ? search([scope]) : null) ?? search(page.nodes);
}

/** USWDS button colors are variants. Spoken color → variant. */
const BUTTON_COLORS: Array<[RegExp, string]> = [
  [/\b(red|secondary)\b/i, "secondary"],
  [/\b(cyan|teal|light blue|cool)\b/i, "accent-cool"],
  [/\b(orange|gold|yellow|warm)\b/i, "accent-warm"],
  [/\b(gr[ae]y|base|dark)\b/i, "base"],
  [/\b(blue|primary|default)\b/i, "default"],
];
const BUTTON_COLOR_CYCLE = ["default", "secondary", "accent-cool", "accent-warm", "base"];

function allNodes(nodes: SpecNode[]): SpecNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? allNodes(n.children) : [])]);
}

/** The new literal text in an edit request. Speech-to-text never adds quotes,
 *  so after quoted strings, look for "… text to X", "… say X", "change … to X". */
export function spokenText(utterance: string): string | undefined {
  const quoted = quotedStrings(utterance).filter((s) => !/^https?:\/\//i.test(s));
  if (quoted.length) return quoted[0];
  const clean = (s: string) => cleanSpoken(s) || undefined;
  const patterns = [
    /\b(?:text|heading|headline|title|label|copy|body|sub ?heading|sub ?title|eyebrow|tagline|paragraph|description|message|wording|button|hero|link)\s+(?:to|into|as|with)\s+(.+)$/i,
    /\b(?:to say|to read|say|says)\s+(.+)$/i,
    /\b(?:change|update|set|rename|replace|edit|reword)\b.*?\s(?:to|with)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = utterance.match(re);
    const text = m && clean(m[1]);
    if (text) return text;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Apply Jev's answers as JSON patches.
// ---------------------------------------------------------------------------

export interface ApplyResult {
  changed: boolean;
  note: string;
  decisions: Decision[];
  pageSwitch?: string;
}

function decision(question: string, answers: Record<string, any>, keys: string[], labels: Record<string, string>): Decision {
  const a = answers[question];
  const choice: string = a?.choice ?? "?";
  const label = labels[choice] ?? choice;
  return { question, choice, label, confidence: typeof a?.confidence === "number" ? a.confidence : null };
}

export function applyJevAnswers(
  utterance: string,
  page: PageSpec,
  pages: PageSpec[],
  candidates: string[],
  answers: Record<string, any>
): ApplyResult {
  const compLabels: Record<string, string> = {};
  candidates.forEach((c, i) => { compLabels[String.fromCharCode(65 + i)] = c; });
  const targetLabels: Record<string, string> = {};
  page.nodes.forEach((n, i) => { targetLabels[String.fromCharCode(65 + i)] = n.id; });
  targetLabels[String.fromCharCode(65 + page.nodes.length)] = "__new__";
  const pageLabels: Record<string, string> = {};
  pages.forEach((p, i) => { pageLabels[String.fromCharCode(65 + i)] = p.pageId; });
  pageLabels[String.fromCharCode(65 + pages.length)] = "__newpage__";

  const decisions: Decision[] = [
    decision("is_ui_instruction", answers, ["A", "B"], { A: "UI instruction", B: "not a UI instruction" }),
    decision("page_intent", answers, Object.keys(pageLabels), pageLabels),
    decision("operation", answers, ["A", "B", "C", "D", "E"], { A: "create", B: "replace", C: "modify", D: "style", E: "remove" }),
    decision("target", answers, Object.keys(targetLabels), targetLabels),
    decision("placement", answers, ["A", "B", "C", "D", "E", "F"], { A: "append", B: "prepend", C: "inside", D: "replace", E: "after", F: "before" }),
    decision("component", answers, Object.keys(compLabels), compLabels),
  ];
  const get = (q: string) => decisions.find((d) => d.question === q)!;

  // Navigating to another existing page isn't a design change, so Jev may call
  // it "not a UI instruction" — honor a confident page answer anyway.
  const pageChoice = get("page_intent").label;
  const isOtherPage = pageChoice !== page.pageId && pages.some((p) => p.pageId === pageChoice);
  const isUi = get("is_ui_instruction").choice === "A";
  if (!isUi && isOtherPage && (get("page_intent").confidence ?? 0) >= 0.7) {
    return { changed: false, note: `Switched to the "${pageChoice}" page.`, decisions, pageSwitch: pageChoice };
  }
  if (!isUi) {
    return { changed: false, note: "Not a UI instruction — no change applied.", decisions };
  }

  // Page routing: a brand-new page, or switching to another existing page.
  if (pageChoice === "__newpage__" || isOtherPage) {
    return { changed: false, note: `Routing to page "${pageChoice}".`, decisions, pageSwitch: pageChoice };
  }

  let op = get("operation").label;
  let targetId = get("target").label;
  const comp = get("component").label;
  const toks = new Set(utterance.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const wantsCta = /call to action|\bcta\b/i.test(utterance);
  const score = (n: SpecNode) => {
    const lbl = labelNode(n).toLowerCase();
    let s = lbl.split(/[^a-z0-9]+/).filter((t) => toks.has(t)).length;
    if (wantsCta && /apply|start|find|sign|enroll|get started|learn more/i.test(lbl)) s += 3;
    return s;
  };
  /** Best same-type match among `nodes` (and their descendants); ties go to the first. */
  const bestOfType = (nodes: SpecNode[], type: string, requireOverlap: boolean): SpecNode | null => {
    const sameType = allNodes(nodes).filter((n) => n.type === type);
    if (!sameType.length) return null;
    const ranked = [...sameType].sort((a, b) => score(b) - score(a));
    if (requireOverlap && sameType.length > 1 && score(ranked[0]) === 0) return null;
    return ranked[0];
  };

  // "Change/update/rename … to X" is an edit even if Jev leaned toward create,
  // as long as a section of that type already exists to edit.
  if (op === "create" && EDIT_RE.test(utterance) && spokenText(utterance) && bestOfType(page.nodes, comp, false)) {
    op = "modify";
  }
  if ((op === "modify" || op === "style") && targetId === "__new__") {
    // Safety net: Jev named the component type but matched no section.
    // Pick the same-type node (nested ones included) with the best token overlap.
    const hit = bestOfType(page.nodes, comp, true);
    if (hit) targetId = hit.id;
  }
  const component = comp;
  const placement = get("placement").label;

  if (op === "remove") {
    if (targetId === "__new__") return { changed: false, note: "Remove asked, but no existing section matched.", decisions };
    let victim = findNode(page, targetId);
    if (!victim) return { changed: false, note: `Could not find ${targetId}.`, decisions };
    // Jev only sees top-level sections, so "remove the cancel button" can come
    // back targeting the whole Form. If the component Jev named lives inside
    // the target, remove that instead of the container.
    if (victim.type !== comp && victim.children) {
      victim = bestOfType(victim.children, comp, false) ?? victim;
    }
    const ok = removeNode(page, victim.id);
    if (ok) page.lastTouched = null;
    return { changed: ok, note: ok ? `Removed ${labelNode(victim)}.` : `Could not find ${victim.id}.`, decisions };
  }

  if (op === "modify") {
    // "change full name to full legal name": match the old words against text
    // already on the page, whatever component Jev picked. Most reliable edit.
    const pair = renamePair(utterance);
    const hit = pair && findByText(page, pair.from, targetId === "__new__" ? null : findNode(page, targetId));
    if (pair && hit) {
      const old = String(hit.node.props[hit.prop]);
      const next = /^[A-Z]/.test(old) ? pair.to.charAt(0).toUpperCase() + pair.to.slice(1) : pair.to;
      hit.node.props[hit.prop] = next;
      page.lastTouched = hit.node.id;
      return { changed: true, note: `Changed ${hit.node.type} ${hit.prop} "${old}" → "${next}".`, decisions };
    }
  }

  if (op === "modify" || op === "style") {
    if (targetId === "__new__") return { changed: false, note: `${op} asked, but no existing section matched.`, decisions };
    let node = findNode(page, targetId);
    if (!node) return { changed: false, note: `Could not find ${targetId}.`, decisions };
    // Jev targets top-level sections; if it picked the container (a Form or
    // ButtonGroup) but the component is a Button inside it, drill down.
    if (node.type !== component && TEXT_PROP[component] && node.children) {
      node = bestOfType(node.children, component, false) ?? node;
    }
    // Modify: extract only the delta the utterance mentions — never clobber
    // props it doesn't (a URL swaps an image; spoken text rewrites a label).
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const delta: Record<string, unknown> = {};
    const url = utterance.match(/https?:\/\/[^\s"'<>]+/)?.[0];
    if (url) {
      if (node.type === "Hero") delta.backgroundUrl = url;
      else if (node.type === "Card") delta.mediaUrl = url;
    }
    const newText = spokenText(utterance);
    if (newText) {
      if (node.type === "Hero") {
        // Which Hero field? Judge only the words before the new text.
        const lead = utterance.slice(0, utterance.lastIndexOf(newText)) || utterance;
        const field = /eyebrow|tagline|kicker|small (?:label|text)/i.test(lead) ? "eyebrow"
          : /\b(body|paragraph|sub ?heading|sub ?title|sub ?text|supporting|description|blurb)\b/i.test(lead) ? "body"
          : "heading";
        delta[field] = newText;
      } else if (TEXT_PROP[node.type]) {
        delta[TEXT_PROP[node.type]] = node.type === "Button" ? cap(newText) : newText;
      }
    }
    // Style ops: map common phrasing onto known styling props.
    if (op === "style") {
      if (/full.?width/i.test(utterance)) delta.fullWidth = true;
      if (node.type === "Button") {
        const current = String(node.props.variant ?? "default");
        const named = BUTTON_COLORS.find(([re]) => re.test(utterance))?.[1];
        const shape = utterance.match(/\b(outline|big|unstyled)\b/i)?.[1]?.toLowerCase();
        if (named) delta.variant = named;
        else if (shape) delta.variant = shape;
        else if (/colou?r/i.test(utterance)) {
          // "change the color" with no color named: step to the next one.
          const i = BUTTON_COLOR_CYCLE.indexOf(current);
          delta.variant = BUTTON_COLOR_CYCLE[(i + 1) % BUTTON_COLOR_CYCLE.length];
        }
        if (delta.variant === current) delete delta.variant;
      } else {
        const color = utterance.match(/\b(green|blue|red|gold|accent)\b/i)?.[1]?.toLowerCase();
        if (color) delta.accent = color;
        const variant = utterance.match(/\b(secondary|outline|big|slim|medium)\b/i)?.[1]?.toLowerCase();
        if (variant && "variant" in node.props) delta.variant = variant;
      }
    }
    for (const [k, v] of Object.entries(delta)) {
      if (v !== null && v !== undefined && !(typeof v === "string" && !v)) node.props[k] = v;
    }
    page.lastTouched = node.id;
    if (!Object.keys(delta).length) {
      return {
        changed: false,
        note: op === "style"
          ? `Found ${labelNode(node)}, but didn't catch a style to apply — try "make the save button red".`
          : `Found ${labelNode(node)}, but couldn't hear the new text — try "change full name to full legal name".`,
        decisions,
      };
    }
    const styled = delta.variant ? ` (variant: ${delta.variant})` : "";
    return { changed: true, note: `${op === "style" ? "Restyled" : "Updated"} ${labelNode(node)}${styled}.`, decisions };
  }

  // create / replace
  const { props, children } = extractNode(component, utterance, page);
  const node: SpecNode = { id: newId(page), type: component, props, ...(children ? { children } : {}) };
  page.lastTouched = node.id;

  const insertInto = (nodes: SpecNode[], idx: number) => { nodes.splice(idx, 0, node); };

  if (op === "replace" || placement === "replace" || placement === "D") {
    if (targetId !== "__new__") {
      const existing = findNode(page, targetId);
      if (existing) {
        node.id = existing.id;
        page.lastTouched = existing.id;
        node.children = node.children ?? existing.children;
        Object.assign(existing, { type: node.type, props: node.props, children: node.children });
        return { changed: true, note: `Replaced ${targetId} with ${component}.`, decisions };
      }
    }
  }

  if (targetId !== "__new__") {
    const target = findNode(page, targetId);
    if (target) {
      if ((placement === "inside" || placement === "C") && CONTAINERS.has(target.type)) {
        target.children = target.children ?? [];
        target.children.push(node);
        return { changed: true, note: `Added ${component} inside ${labelNode(target)}.`, decisions };
      }
      // sibling insert relative to a top-level target
      const idx = page.nodes.findIndex((n) => n.id === targetId);
      if (idx >= 0) {
        insertInto(page.nodes, placement === "before" || placement === "F" ? idx : idx + 1);
        return { changed: true, note: `Added ${component} ${placement === "before" || placement === "F" ? "before" : "after"} ${labelNode(target)}.`, decisions };
      }
    }
  }

  if (placement === "prepend" || placement === "B") insertInto(page.nodes, 0);
  else page.nodes.push(node);
  return { changed: true, note: `Added ${component} to the ${placement === "prepend" ? "top" : "end"} of the page.`, decisions };
}

/** Guess a page id for a brand-new page from the utterance. */
export function guessPageId(utterance: string): string {
  const u = utterance.toLowerCase();
  if (/sign.?in|log.?in/.test(u)) return "signin";
  if (/dashboard|overview/.test(u)) return "dashboard";
  if (/profile|account settings/.test(u)) return "profile";
  if (/market|landing|home\s?page/.test(u)) return "marketing";
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const q = quotedStrings(utterance)[0];
  if (q && slug(q)) return slug(q);
  // "a route called status", "a page named benefits"
  const named = u.match(/\b(?:page|route|path|url)\s+(?:called|named)\s+([a-z0-9][a-z0-9\s-]*?)(?:[.,!?]|\s+(?:and|that|with|where|which)\b|$)/);
  if (named && slug(named[1])) return slug(named[1]);
  // "a status tracker page" — the words right before "page"/"route", minus filler
  const before = u.match(/([a-z0-9\s-]+?)\s+(?:page|route)\b/);
  if (before) {
    const FILLER = new Set(["a", "an", "the", "new", "my", "this", "that", "our", "build", "make", "create", "add", "start", "open", "called", "named", "can", "you", "please", "i'd", "like", "to", "want", "is", "for", "of", "web", "website", "whole", "entire", "simple", "basic"]);
    const words = before[1].trim().split(/\s+/);
    const kept: string[] = [];
    for (let i = words.length - 1; i >= 0 && !FILLER.has(words[i]); i--) kept.unshift(words[i]);
    if (kept.length && slug(kept.join(" "))) return slug(kept.join(" "));
  }
  return "page";
}

/** Seed a brand-new page with the component Jev chose for the utterance. */
export function seedNewPage(utterance: string, page: PageSpec, decisions: Decision[]): string | null {
  const get = (q: string) => decisions.find((d) => d.question === q);
  const op = get("operation")?.label;
  const component = get("component")?.label;
  if ((op !== "create" && op !== "replace") || !component || !META[component]) return null;
  const { props, children } = extractNode(component, utterance, page);
  const node: SpecNode = { id: newId(page), type: component, props, ...(children ? { children } : {}) };
  if (get("placement")?.label === "prepend") page.nodes.unshift(node);
  else page.nodes.push(node);
  page.lastTouched = node.id;
  return component;
}
