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
  [/header|navigation( bar)?|nav menu|menu/i, ["Header"]],
  [/footer/i, ["Footer"]],
  [/feature cards?|^cards?|card grid/i, ["CardGroup", "Card"]],
  [/\bcard\b/i, ["Card"]],
  [/sign ?in|log ?in|password/i, ["Form", "Input", "Password", "Button"]],
  [/form/i, ["Form"]],
  [/\bemail\b/i, ["Input"]],
  [/\binput\b|\bfield\b|textbox/i, ["Input"]],
  [/\bbuttons?\b/i, ["Button", "ButtonGroup"]],
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
  [/steps?|step indicator|multi.?step|wizard/i, ["StepIndicator"]],
  [/summary|key info/i, ["SummaryBox"]],
  [/\bsearch\b/i, ["Search"]],
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

function colonList(utterance: string): string[] {
  const m = utterance.match(/:\s*(.+)$/);
  if (!m) return [];
  return m[1].split(/,|\band\b/i).map((s) => s.replace(/^["“”\s]+|["“”\s.]+$/g, "").trim()).filter(Boolean);
}

function slug(s: string): string {
  return "/" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fieldNode(kind: string, label: string, page: PageSpec): SpecNode {
  const name = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  if (/date of birth|birthday/i.test(label)) {
    return { id: newId(page), type: "DateInputGroup", props: { label: "Date of birth", name: "dob", hint: "For example: January 19 2000" } };
  }
  if (/password/i.test(label)) {
    return { id: newId(page), type: "Password", props: { label: "Password", name: "password", hint: null } };
  }
  if (/phone/i.test(label)) {
    return { id: newId(page), type: "Input", props: { label: "Phone number", name: "phone", type: "tel", placeholder: "(555) 123-4567" } };
  }
  if (/email/i.test(label)) {
    return { id: newId(page), type: "Input", props: { label: "Email address", name: "email", type: "email" } };
  }
  return { id: newId(page), type: kind, props: { label: pretty, name } };
}

/** Field mentions for forms: colon lists first ("fields: a, b"), then
 *  "fields for a, b and c", then a bare "an email input and a password input". */
function fieldList(utterance: string): string[] {
  const fromColon = colonList(utterance);
  if (fromColon.length) return fromColon;
  const fm = utterance.match(/fields?\s+(?:for\s+)?(.+)$/i);
  const src = fm
    ? fm[1]
    : utterance.replace(/^(add|create|make|put|include)\s+/i, "").replace(/^(a|an|the)\s+/i, "");
  const parts = src
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.replace(/^(an?|the)\s+/i, "").replace(/\s+(inputs?|fields?)$/i, "").trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 6 || parts.some((p) => p.split(/\s+/).length > 4)) return [];
  return parts;
}

/** Build props + children for a new node of `component`, from the utterance. */
export function extractNode(component: string, utterance: string, page: PageSpec): { props: Record<string, unknown>; children?: SpecNode[] } {
  const q = quotedStrings(utterance);
  const items = colonList(utterance);
  const forMatch = utterance.match(/for ([A-Z][\w ]+?)(?:,|\.|$)/);

  switch (component) {
    case "Hero":
      return { props: { heading: q[0] ?? "Welcome", eyebrow: null, body: q[1] ?? null, backgroundUrl: null, ariaLabel: "Introduction" } };
    case "GovBanner":
      return { props: { tld: ".gov" } };
    case "SiteAlert":
      return { props: { heading: q[0] ?? "Demo site", message: q[1] ?? "This is a fictional demonstration service.", type: "info" } };
    case "Header": {
      const navItems = items.length
        ? items.map((label, i) => ({ label, href: label.toLowerCase().includes("sign") ? "/signin" : slug(label), current: i === 0, items: null }))
        : [{ label: "Home", href: "/", current: true, items: null }];
      return { props: { variant: "basic", siteName: forMatch?.[1]?.trim() ?? q[0] ?? "Benefit Tracker", siteUrl: "/", logoUrl: null, logoAlt: null, navItems, showSearch: false } };
    }
    case "Footer":
      return {
        props: {
          variant: /slim/i.test(utterance) ? "slim" : /big/i.test(utterance) ? "big" : "medium",
          agencyName: forMatch?.[1]?.trim() ?? q[0] ?? "Benefit Tracker",
          agencyUrl: "/", logoUrl: null, logoAlt: null,
          navGroups: [{ heading: null, links: [{ label: "Home", href: "/" }, { label: "Help", href: "/help" }] }],
          contactHeading: null, contactInfo: null, socialLinks: [], returnToTop: true,
        },
      };
    case "CardGroup": {
      const cards = (items.length ? items : q.length ? q : ["Feature one", "Feature two", "Feature three"]).map((t) => ({
        id: newId(page), type: "Card", props: { title: t, description: null, headerFirst: null, mediaUrl: null, mediaAlt: null, flag: null },
      }));
      return { props: {}, children: cards };
    }
    case "Card":
      return { props: { title: q[0] ?? items[0] ?? "Card", description: q[1] ?? null, headerFirst: null, mediaUrl: null, mediaAlt: null, flag: null } };
    case "Form": {
      const fields = fieldList(utterance);
      const list = fields.length ? fields : ["Full name", "Email address"];
      return { props: { large: false }, children: list.map((f) => fieldNode("Input", f, page)) };
    }
    case "Input": {
      if (/email/i.test(utterance)) return { props: { label: q[0] ?? "Email address", name: "email", type: "email", placeholder: null, hint: null } };
      if (/phone/i.test(utterance)) return { props: { label: q[0] ?? "Phone number", name: "phone", type: "tel", placeholder: null, hint: null } };
      return { props: { label: q[0] ?? "Text input", name: "input", type: "text", placeholder: null, hint: null } };
    }
    case "Password":
      return { props: { label: q[0] ?? "Password", name: "password", hint: null } };
    case "Button": {
      const rawLabel = q[0] ?? utterance.match(/(?:add|make|put)\s+(?:a\s+)?(.+?)\s+button/i)?.[1]?.trim() ?? "Submit";
      const label = rawLabel.replace(/^(primary|secondary|outline)\s+/i, "") || rawLabel;
      const variant = /secondary/i.test(utterance) ? "secondary" : /outline/i.test(utterance) ? "outline" : "default";
      return { props: { label: label.charAt(0).toUpperCase() + label.slice(1), variant, disabled: false, type: "button" } };
    }
    case "ButtonGroup": {
      const labels = items.length ? items : q.length ? q : ["Save", "Cancel"];
      return {
        props: { segmented: false },
        children: labels.map((l, i) => ({
          id: newId(page), type: "Button",
          props: { label: l, variant: i === 0 ? "default" : "secondary", disabled: false, type: "button" },
        })),
      };
    }
    case "Checkbox":
      return { props: { label: q[0] ?? "Checkbox", name: "checkbox", hint: null, checked: /check(ed)?( by default)?|default/i.test(utterance) || null } };
    case "Alert": {
      const type = /success/i.test(utterance) ? "success" : /error/i.test(utterance) ? "error" : /warning/i.test(utterance) ? "warning" : "info";
      return { props: { heading: q[0] ?? null, message: q[1] ?? q[0] ?? "Alert message.", type, slim: false, noIcon: false } };
    }
    case "Table": {
      const columns = items.length ? items : ["Column one", "Column two", "Column three"];
      return { props: { columns, rows: [], borderless: false, striped: true, compact: false } };
    }
    case "Heading": {
      const level = page.nodes.some((n) => n.type === "Heading") ? "h2" : "h1";
      return { props: { text: q[0] ?? "Page title", level } };
    }
    case "Text":
      return { props: { text: q[0] ?? "Supporting text.", variant: /lead/i.test(utterance) ? "lead" : "body" } };
    case "SideNav": {
      const links = (items.length ? items : ["Overview"]).map((l) => ({ id: newId(page), type: "Link", props: { label: l, href: slug(l) } }));
      return { props: { ariaLabel: "Side navigation" }, children: links };
    }
    case "Tag":
      return { props: { text: q[0] ?? "New", big: false } };
    case "SummaryBox":
      return { props: { heading: q[0] ?? "Key information", items: items.length ? items : ["Item one", "Item two"] } };
    case "StepIndicator": {
      const steps = items.length ? items : ["Step one", "Step two", "Step three"];
      return { props: { steps, currentStep: 1 } };
    }
    case "GraphicList": {
      const gl = (items.length ? items : q).map((t) => ({ imageUrl: null, imageAlt: null, heading: t, content: null }));
      return { props: { heading: q[0] && items.length ? q[0] : null, items: gl.length ? gl : [{ imageUrl: null, imageAlt: null, heading: "Feature", content: null }] } };
    }
    case "Select":
      return { props: { label: q[0] ?? "Select", name: "select", options: items.length ? items : ["Option one", "Option two"] } };
    case "Textarea":
      return { props: { label: q[0] ?? "Message", name: "message", rows: 4 } };
    case "DateInputGroup":
      return { props: { label: q[0] ?? "Date of birth", name: "dob", hint: "For example: January 19 2000" } };
    case "List":
      return { props: {}, children: (items.length ? items : ["Item one", "Item two"]).map((t) => ({ id: newId(page), type: "Text", props: { text: t, variant: "body" } })) };
    default:
      return { props: {} };
  }
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

  if (get("is_ui_instruction").choice !== "A") {
    return { changed: false, note: "Not a UI instruction — no change applied.", decisions };
  }

  // Page routing: a brand-new page, or switching to another existing page.
  const pageChoice = get("page_intent").label;
  if (pageChoice === "__newpage__" || (pageChoice !== page.pageId && pages.some((p) => p.pageId === pageChoice))) {
    return { changed: false, note: `Routing to page "${pageChoice}".`, decisions, pageSwitch: pageChoice };
  }

  const op = get("operation").label;
  let targetId = get("target").label;
  if ((op === "modify" || op === "style") && targetId === "__new__") {
    // Safety net: Jev named the component type but matched no section.
    // Pick the same-type node with the best token overlap against the utterance.
    const comp = get("component").label;
    const sameType = page.nodes.filter((n) => n.type === comp);
    if (sameType.length) {
      const toks = new Set(
        utterance.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)
      );
      const wantsCta = /call to action|\bcta\b/i.test(utterance);
      const score = (n: SpecNode) => {
        const lbl = labelNode(n).toLowerCase();
        let s = lbl.split(/[^a-z0-9]+/).filter((t) => toks.has(t)).length;
        if (wantsCta && /apply|start|find|sign|enroll|get started|learn more/i.test(lbl)) s += 3;
        return s;
      };
      const ranked = [...sameType].sort((a, b) => score(b) - score(a));
      if (score(ranked[0]) > 0) targetId = ranked[0].id;
    }
  }
  const component = get("component").label;
  const placement = get("placement").label;

  if (op === "remove") {
    if (targetId === "__new__") return { changed: false, note: "Remove asked, but no existing section matched.", decisions };
    const ok = removeNode(page, targetId);
    return { changed: ok, note: ok ? `Removed ${targetId}.` : `Could not find ${targetId}.`, decisions };
  }

  if (op === "modify" || op === "style") {
    if (targetId === "__new__") return { changed: false, note: `${op} asked, but no existing section matched.`, decisions };
    const node = findNode(page, targetId);
    if (!node) return { changed: false, note: `Could not find ${targetId}.`, decisions };
    // Modify: extract only the delta the utterance mentions — never clobber
    // props it doesn't (a quoted URL swaps an image; quoted text rewrites a label).
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const delta: Record<string, unknown> = {};
    const url = utterance.match(/https?:\/\/[^\s"'<>]+/)?.[0];
    const quotes = quotedStrings(utterance).filter((s) => !/^https?:\/\//i.test(s));
    if (url) {
      if (node.type === "Hero") delta.backgroundUrl = url;
      else if (node.type === "Card") delta.mediaUrl = url;
    }
    const newText =
      quotes[0] ?? utterance.match(/\bsay\s+(.+?)[.]?$/i)?.[1]?.replace(/^["']|["']$/g, "").trim();
    if (newText) {
      if (node.type === "Button") delta.label = cap(newText);
      else if (node.type === "Heading") delta.text = newText;
      else if (node.type === "Text") delta.text = newText;
      else if (node.type === "Hero") delta.heading = newText;
      else if (node.type === "Alert") delta.message = newText;
      else if (node.type === "Link") delta.label = newText;
    }
    // Style ops: map common phrasing onto known styling props.
    if (op === "style") {
      if (/full.?width/i.test(utterance)) node.props["fullWidth"] = true;
      const color = utterance.match(/\b(green|blue|red|gold|accent)\b/i)?.[1]?.toLowerCase();
      if (color) node.props["accent"] = color;
      const variant = utterance.match(/\b(secondary|outline|big|slim|medium)\b/i)?.[1]?.toLowerCase();
      if (variant && "variant" in node.props) node.props["variant"] = variant;
    }
    for (const [k, v] of Object.entries(delta)) {
      if (v !== null && v !== undefined && !(typeof v === "string" && !v)) node.props[k] = v;
    }
    return { changed: Object.keys(delta).length > 0, note: `${op === "style" ? "Restyled" : "Updated"} ${labelNode(node)}.`, decisions };
  }

  // create / replace
  const { props, children } = extractNode(component, utterance, page);
  const node: SpecNode = { id: newId(page), type: component, props, ...(children ? { children } : {}) };

  const insertInto = (nodes: SpecNode[], idx: number) => { nodes.splice(idx, 0, node); };

  if (op === "replace" || placement === "replace" || placement === "D") {
    if (targetId !== "__new__") {
      const existing = findNode(page, targetId);
      if (existing) {
        node.id = existing.id;
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
  const q = quotedStrings(utterance)[0];
  if (q) return q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "page";
  return "page";
}
