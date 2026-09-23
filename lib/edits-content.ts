/**
 * Content edits: select/radio/checkbox/combo-box options, link hrefs, alert
 * type/heading/message/slim/icon, field type conversions, card details, and
 * header/footer settings. Documented in lib/commands-content.ts.
 */
import type { SpecNode, PageSpec } from "./spec";
import {
  Handler, allNodes, cap, cleanSpoken, describe, lastTouched, resolve, tokens, unquote, sentence } from "./edit-helpers";

// ---------------------------------------------------------------------------
// Options: Select, Radio, CheckboxGroup, ComboBox
// ---------------------------------------------------------------------------

const OPTION_TYPES = ["Select", "Radio", "CheckboxGroup", "ComboBox"];
const OPTION_WORDS = /\b(?:the\s+)?(?:drop ?down|select(?:\s+menu)?|options?|radio(?:\s+group|\s+buttons)?|check ?box(?:es)?(?:\s+group)?|combo ?box|field)\b/gi;

const labelOf = (n: SpecNode): string => String(n.props.label ?? n.props.legend ?? "");
const optionsOf = (n: SpecNode): unknown[] => (n.props.options as unknown[]) ?? [];
const isSimple = (opts: unknown[]): boolean => opts.every((o) => typeof o === "string");
const slugValue = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option";

/** A new option entry matching the shape the field already uses (bare
 *  strings for Select/ComboBox, {label, value, hint} objects for Radio/CheckboxGroup). */
function optionEntry(n: SpecNode, label: string): unknown {
  const opts = optionsOf(n);
  if (opts.length ? isSimple(opts) : (n.type === "Select" || n.type === "ComboBox")) return label;
  return { label, value: slugValue(label), hint: null };
}

function entryLabel(o: unknown): string {
  return typeof o === "string" ? o : String((o as { label: string }).label ?? "");
}

/** "the state dropdown", "contact method", "it" → the Select/Radio/CheckboxGroup/ComboBox it means. */
function resolveOptionField(page: PageSpec, phrase: string): SpecNode | null {
  const trimmed = phrase.trim();
  if (/^(?:it|that|this|that one|this one)$/i.test(trimmed)) return lastTouched(page, OPTION_TYPES);
  const fields = allNodes(page.nodes).filter((n) => OPTION_TYPES.includes(n.type));
  const want = tokens(trimmed.replace(OPTION_WORDS, " "));
  if (want.length) {
    const scored = fields
      .map((n) => ({ n, overlap: want.filter((t) => tokens(labelOf(n)).includes(t)).length }))
      .filter((s) => s.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (scored.length) return scored[0].n;
  }
  return fields.length === 1 ? fields[0] : null;
}

/**
 * add Texas to the state dropdown · remove Alaska from the state dropdown ·
 * give it the options yes, no, not sure · set the options for contact method to email, phone, text
 */
const options: Handler = (u, page) => {
  let m = u.match(/^add\s+(.+?)\s+to\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const node = resolveOptionField(page, m[2]);
    if (!node) return null;
    const label = cap(unquote(m[1]));
    node.props.options = [...optionsOf(node), optionEntry(node, label)];
    return { kind: "options", changed: true, touched: node.id, note: `Added "${label}" to ${describe(node)}.` };
  }
  m = u.match(/^(?:remove|delete|take out|drop)\s+(.+?)\s+from\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const node = resolveOptionField(page, m[2]);
    if (!node) return null;
    const want = unquote(m[1]).toLowerCase();
    const opts = optionsOf(node);
    const i = opts.findIndex((o) => entryLabel(o).toLowerCase() === want);
    if (i < 0) return null;
    const gone = entryLabel(opts[i]);
    node.props.options = opts.filter((_, j) => j !== i);
    return { kind: "options", changed: true, touched: node.id, note: `Removed "${gone}" from ${describe(node)}.` };
  }
  let target: string | null = null;
  let listStr: string | null = null;
  m = u.match(/^give\s+(.+?)\s+(?:the\s+)?options?\s+(.+)$/i);
  if (m) [target, listStr] = [m[1], m[2]];
  if (!target) {
    m = u.match(/^set\s+(?:the\s+)?options?\s+for\s+(.+?)\s+to\s+(.+)$/i);
    if (m) [target, listStr] = [m[1], m[2]];
  }
  if (target && listStr) {
    const node = resolveOptionField(page, target);
    if (!node) return null;
    const labels = listStr.split(/\s*,\s*|\s+and\s+/i).map((s) => cap(unquote(s))).filter(Boolean);
    if (!labels.length) return null;
    node.props.options = labels.map((l) => optionEntry(node, l));
    return { kind: "options", changed: true, touched: node.id, note: `Set the options for ${describe(node)} to ${labels.join(", ")}.` };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Links: Button/Link hrefs, and header/side-nav/footer nav item hrefs
// ---------------------------------------------------------------------------

/** "slash apply" → "/apply"; "slash apply slash form" → "/apply/form";
 *  "benefits dot gov" → "benefits.gov"; an https URL is kept as typed. */
function spokenUrl(text: string): string {
  const t = unquote(text).replace(/[.!?]+$/, "").trim();
  if (/^https?:\/\//i.test(t)) return t;
  const lower = t.toLowerCase();
  if (/^slash\b/i.test(lower)) {
    const segments = lower
      .replace(/^slash\s+/i, "")
      .split(/\s+slash\s+/i)
      .map((seg) => seg.trim().replace(/\s+dot\s+/gi, ".").replace(/\s+/g, "-"))
      .filter(Boolean);
    return "/" + segments.join("/");
  }
  if (/\bdot\b/i.test(lower)) return lower.replace(/\s+dot\s+/gi, ".").replace(/\s+/g, "-");
  return "/" + lower.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A nav-item-shaped link living inside a Header, Footer, or SideNav that isn't its own SpecNode. */
function findNavLink(page: PageSpec, label: string): { setHref: (href: string) => void; describe: string } | null {
  const want = label.trim().toLowerCase();
  if (!want) return null;
  const header = allNodes(page.nodes).find((n) => n.type === "Header");
  if (header) {
    const items = (header.props.navItems as Array<{ label: string; href: string }>) ?? [];
    const i = items.findIndex((it) => it.label.toLowerCase() === want);
    if (i >= 0) {
      return {
        setHref: (href) => { header.props.navItems = items.map((it, j) => (j === i ? { ...it, href } : it)); },
        describe: `"${items[i].label}" in the navigation`,
      };
    }
  }
  const footer = allNodes(page.nodes).find((n) => n.type === "Footer");
  if (footer) {
    const groups = (footer.props.navGroups as Array<{ heading: string | null; links: Array<{ label: string; href: string }> }>) ?? [];
    for (const g of groups) {
      const i = g.links.findIndex((l) => l.label.toLowerCase() === want);
      if (i >= 0) {
        const label2 = g.links[i].label;
        return {
          setHref: (href) => { g.links[i] = { ...g.links[i], href }; footer.props.navGroups = [...groups]; },
          describe: `"${label2}" in the footer`,
        };
      }
    }
  }
  return null;
}

/**
 * link the apply button to slash apply · make Help go to slash support ·
 * link the read more link to benefits dot gov · link the apply button to https://benefits.gov/apply
 */
const links: Handler = (u, page) => {
  const m =
    u.match(/^(?:link|point|connect)\s+(.+?)\s+to\s+(.+)$/i) ??
    u.match(/^(?:make|set)\s+(.+?)\s+(?:go to|point to|link to)\s+(.+)$/i) ??
    u.match(/^(?:change|update)\s+(?:the\s+)?(.+?)\s+(?:link|href)\s+to\s+(.+)$/i);
  if (!m) return null;
  const phrase = m[1].replace(/\s+link$/i, "").trim();
  const url = spokenUrl(m[2]);
  if (!phrase || !url) return null;
  const node = resolve(page, phrase, ["Button", "Link"]);
  if (node) {
    node.props.href = url;
    return { kind: "link", changed: true, touched: node.id, note: `Linked ${describe(node)} to "${url}".` };
  }
  const target = findNavLink(page, phrase);
  if (!target) return null;
  target.setHref(url);
  return { kind: "link", changed: true, note: `Linked ${target.describe} to "${url}".` };
};

// ---------------------------------------------------------------------------
// Alerts: Alert and SiteAlert
// ---------------------------------------------------------------------------

const ALERT_TYPES: Array<[RegExp, string]> = [
  [/\bemergency\b/i, "emergency"],
  [/\berror\b|\bdanger\b/i, "error"],
  [/\bwarning\b|\bcaution\b/i, "warning"],
  [/\bsuccess\b/i, "success"],
  [/\binfo(?:rmation(?:al)?)?\b/i, "info"],
];

/**
 * make the alert a warning · make the alert an error · change the alert heading to … ·
 * change the alert message to … · make the alert slim · remove the alert icon
 */
const alerts: Handler = (u, page) => {
  const node = resolve(page, u, ["Alert", "SiteAlert"]) ?? resolve(page, "the alert", ["Alert", "SiteAlert"]);
  if (!node) return null;

  const typeHit = ALERT_TYPES.find(([re]) => re.test(u));
  if (typeHit && /^(?:make|set|turn|change)\b/i.test(u) && !/\bheading\b|\bmessage\b|\bicon\b|\bslim\b/i.test(u)) {
    const type = typeHit[1];
    if (node.type === "SiteAlert" && type !== "info" && type !== "emergency") return null;
    node.props.type = type;
    return { kind: "alert", changed: true, touched: node.id, note: `${describe(node)} is now type "${type}".` };
  }

  let m = u.match(/^(?:change|set|update)\s+(?:the\s+)?(?:site\s+)?alert\s+(heading|message)\s+to\s+(.+)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    const text = cap(cleanSpoken(m[2]));
    node.props[key] = text;
    return { kind: "alert", changed: true, touched: node.id, note: `Set the alert ${key} to "${text}".` };
  }

  if (/^(?:make|set|turn)\b/i.test(u) && /\bslim\b/i.test(u)) {
    const slim = !/\b(?:not|un-?)slim\b/i.test(u);
    node.props.slim = slim;
    return { kind: "alert", changed: true, touched: node.id, note: `Made ${describe(node)} ${slim ? "slim" : "normal size"}.` };
  }

  if (/\bicon\b/i.test(u) && node.type === "Alert") {
    const remove = /^(?:remove|hide|drop|turn off)\b/i.test(u);
    node.props.noIcon = remove;
    return { kind: "alert", changed: true, touched: node.id, note: `${remove ? "Removed" : "Restored"} the icon on ${describe(node)}.` };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Field types: convert Input/Textarea/etc between field kinds
// ---------------------------------------------------------------------------

const FIELD_CONVERT_TYPES = ["Input", "Password", "Textarea", "Select", "InputMask", "CharacterCount", "ComboBox"];
const COUNTING_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function baseFieldProps(n: SpecNode) {
  return {
    label: String(n.props.label ?? n.props.legend ?? "Field"),
    name: String(n.props.name ?? "field"),
    hint: (n.props.hint as string | null) ?? null,
    required: (n.props.required as boolean | null) ?? null,
  };
}

/**
 * make contact email an email field · make phone a phone number field · make message a text area ·
 * make state a dropdown · make it a password field · make the feedback box taller ·
 * give the feedback field 8 rows · limit the feedback field to 200 characters
 */
const fieldTypes: Handler = (u, page) => {
  let m = u.match(/^(?:make|turn|change|set)\s+(.+?)\s+(?:an?\s+|into an?\s+)?(email|phone number|telephone|url|website|number)\s+field$/i);
  if (m) {
    const node = resolve(page, m[1], FIELD_CONVERT_TYPES);
    if (!node) return null;
    const kind = m[2].toLowerCase();
    const base = baseFieldProps(node);
    if (/phone|telephone/.test(kind)) {
      node.type = "InputMask";
      node.props = { label: base.label, name: base.name, preset: "phone", hint: base.hint ?? "(___) ___-____", value: null, required: base.required, checks: null, validateOn: null };
      return { kind: "field", changed: true, touched: node.id, note: `${base.label} is now a phone number field.` };
    }
    if (node.type !== "Input") return null;
    node.props.type = /email/.test(kind) ? "email" : /url|website/.test(kind) ? "url" : "number";
    return { kind: "field", changed: true, touched: node.id, note: `${describe(node)} is now a ${node.props.type} field.` };
  }

  m = u.match(/^(?:make|turn|change|set)\s+(.+?)\s+(?:an?\s+|into an?\s+)?(?:text ?area|multi-?line (?:field|box))$/i);
  if (m) {
    const node = resolve(page, m[1], FIELD_CONVERT_TYPES);
    if (!node || node.type === "Textarea") return null;
    const base = baseFieldProps(node);
    node.type = "Textarea";
    node.props = { label: base.label, name: base.name, placeholder: null, hint: base.hint, rows: 4, value: null, required: base.required, checks: null, validateOn: null };
    return { kind: "field", changed: true, touched: node.id, note: `${base.label} is now a text area.` };
  }

  m = u.match(/^(?:make|turn|change|set)\s+(.+?)\s+(?:an?\s+|into an?\s+)?(?:drop ?down|select(?:\s+menu)?)$/i);
  if (m) {
    const node = resolve(page, m[1], FIELD_CONVERT_TYPES);
    if (!node || node.type === "Select") return null;
    const base = baseFieldProps(node);
    node.type = "Select";
    node.props = { label: base.label, name: base.name, options: [], placeholder: null, hint: base.hint, value: null, required: base.required, checks: null, validateOn: null };
    return { kind: "field", changed: true, touched: node.id, note: `${base.label} is now a dropdown.` };
  }

  m = u.match(/^(?:make|turn|change|set)\s+(.+?)\s+(?:an?\s+|into an?\s+)?password(?:\s+field)?$/i);
  if (m) {
    const node = resolve(page, m[1], FIELD_CONVERT_TYPES);
    if (!node || node.type === "Password") return null;
    const base = baseFieldProps(node);
    node.type = "Password";
    node.props = { label: base.label, name: base.name, hint: base.hint, value: null, required: base.required, checks: null, validateOn: null };
    return { kind: "field", changed: true, touched: node.id, note: `${base.label} is now a password field.` };
  }

  m = u.match(/^(?:make|change|set)\s+(.+?)\s+(?:box\s+)?taller$/i);
  if (m) {
    const node = resolve(page, m[1].replace(/\s+box$/i, ""), ["Textarea", "CharacterCount"]);
    if (!node) return null;
    const rows = Number(node.props.rows ?? 4) + 4;
    node.props.rows = rows;
    return { kind: "field", changed: true, touched: node.id, note: `${describe(node)} now has ${rows} rows.` };
  }

  m = u.match(/^(?:give|set)\s+(.+?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+rows?$/i);
  if (m) {
    const node = resolve(page, m[1], ["Textarea", "CharacterCount"]);
    if (!node) return null;
    const n = /^\d+$/.test(m[2]) ? Number(m[2]) : COUNTING_WORDS.indexOf(m[2].toLowerCase()) + 1;
    node.props.rows = n;
    return { kind: "field", changed: true, touched: node.id, note: `${describe(node)} now has ${n} rows.` };
  }

  m = u.match(/^(?:limit|restrict)\s+(.+?)\s+to\s+(\d+)\s+characters?$/i);
  if (m) {
    const node = resolve(page, m[1], ["Input", "Textarea", "CharacterCount"]);
    if (!node) return null;
    const base = baseFieldProps(node);
    const wasTextarea = node.type === "Textarea";
    const oldRows = node.props.rows;
    node.type = "CharacterCount";
    node.props = {
      label: base.label, name: base.name, maxLength: Number(m[2]), hint: base.hint, value: null,
      multiline: wasTextarea, rows: wasTextarea ? (oldRows ?? 4) : null, required: base.required, checks: null, validateOn: null,
    };
    return { kind: "field", changed: true, touched: node.id, note: `${base.label} is now limited to ${m[2]} characters.` };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Cards: description, title, image, flag style, header-first
// ---------------------------------------------------------------------------

/** Fallback placeholder image when a "add an image" request names no URL. */
const CARD_PLACEHOLDER_IMAGE = "/images/card-placeholder.svg";

/**
 * add a description to the apply card that says … · change the check status card title to … ·
 * add an image to the apply card · make the cards flag style · put the card heading first
 */
const cards: Handler = (u, page) => {
  let m = u.match(/^(?:add|set|give)\s+(?:a\s+)?description\s+to\s+(?:the\s+)?(.+?)\s+(?:that says|saying|to say|that reads)\s+(.+)$/i);
  if (m) {
    const node = resolve(page, m[1], ["Card"]);
    if (!node) return null;
    const text = sentence(cap(cleanSpoken(m[2])));
    node.props.description = text;
    return { kind: "card", changed: true, touched: node.id, note: `Set the description on ${describe(node)} to "${text}".` };
  }

  m = u.match(/^(?:change|set|update|rename)\s+(?:the\s+)?(.+?)\s+card\s+title\s+to\s+(.+)$/i);
  if (m) {
    const node = resolve(page, m[1], ["Card"]);
    if (!node) return null;
    const text = cap(cleanSpoken(m[2]));
    node.props.title = text;
    return { kind: "card", changed: true, touched: node.id, note: `Renamed ${describe(node)} to "${text}".` };
  }

  m = u.match(/^add\s+(?:an?\s+)?image\s+to\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const node = resolve(page, m[1], ["Card"]);
    if (!node) return null;
    const url = u.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? CARD_PLACEHOLDER_IMAGE;
    node.props.mediaUrl = url;
    if (!node.props.mediaAlt) node.props.mediaAlt = "";
    return { kind: "card", changed: true, touched: node.id, note: `Added an image to ${describe(node)}.` };
  }

  if (/^(?:make|turn|set)\s+(?:the\s+)?cards?\s+flag(?:\s+style)?$/i.test(u)) {
    const group = allNodes(page.nodes).filter((n) => n.type === "Card");
    if (!group.length) return null;
    group.forEach((c) => { c.props.flag = true; });
    return { kind: "card", changed: true, note: `Made ${group.length} card${group.length > 1 ? "s" : ""} flag style.` };
  }

  m = u.match(/^(?:put|make)\s+(?:the\s+)?(?:(.+?)\s+)?cards?\s+heading\s+first$/i);
  if (m) {
    const targets = m[1] ? [resolve(page, m[1], ["Card"])].filter((n): n is SpecNode => !!n) : allNodes(page.nodes).filter((n) => n.type === "Card");
    if (!targets.length) return null;
    targets.forEach((c) => { c.props.headerFirst = true; });
    return { kind: "card", changed: true, touched: targets[0].id, note: `Put the heading first on ${targets.length > 1 ? `${targets.length} cards` : describe(targets[0])}.` };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Header & footer settings
// ---------------------------------------------------------------------------

/**
 * change the site name to … · change the agency name to … · add a search box to the header ·
 * remove the search from the header · make the header extended · make the footer big ·
 * add a back to top link · turn off return to top
 */
const headerFooter: Handler = (u, page) => {
  const header = allNodes(page.nodes).find((n) => n.type === "Header");
  const footer = allNodes(page.nodes).find((n) => n.type === "Footer");

  let m = u.match(/^(?:change|set|update)\s+(?:the\s+)?site\s+name\s+to\s+(.+)$/i);
  if (m) {
    if (!header) return null;
    const name = cap(cleanSpoken(m[1]));
    header.props.siteName = name;
    return { kind: "header", changed: true, touched: header.id, note: `Set the site name to "${name}".` };
  }

  m = u.match(/^(?:change|set|update)\s+(?:the\s+)?agency\s+name\s+to\s+(.+)$/i);
  if (m) {
    if (!footer) return null;
    const name = cap(cleanSpoken(m[1]));
    footer.props.agencyName = name;
    return { kind: "footer", changed: true, touched: footer.id, note: `Set the agency name to "${name}".` };
  }

  if (/^add\s+(?:a\s+)?search(?:\s+box)?\s+to\s+(?:the\s+)?header$/i.test(u)) {
    if (!header) return null;
    header.props.showSearch = true;
    return { kind: "header", changed: true, touched: header.id, note: "Added a search box to the header." };
  }

  if (/^(?:remove|turn off|hide)\s+(?:the\s+)?search(?:\s+box)?(?:\s+from\s+(?:the\s+)?header)?$/i.test(u)) {
    if (!header) return null;
    header.props.showSearch = false;
    return { kind: "header", changed: true, touched: header.id, note: "Removed the search box from the header." };
  }

  if (/^make\s+(?:the\s+)?header\s+extended$/i.test(u)) {
    if (!header) return null;
    header.props.variant = "extended";
    return { kind: "header", changed: true, touched: header.id, note: "Made the header extended." };
  }

  m = u.match(/^make\s+(?:the\s+)?footer\s+(slim|medium|big)$/i);
  if (m) {
    if (!footer) return null;
    footer.props.variant = m[1].toLowerCase();
    return { kind: "footer", changed: true, touched: footer.id, note: `Made the footer ${m[1].toLowerCase()}.` };
  }

  if (/^add\s+a\s+back\s+to\s+top\s+link$/i.test(u)) {
    if (!footer) return null;
    footer.props.returnToTop = true;
    return { kind: "footer", changed: true, touched: footer.id, note: "Added a back to top link." };
  }

  if (/^turn off\s+return to top$/i.test(u) || /^remove\s+(?:the\s+)?(?:back to top|return to top)(?:\s+link)?$/i.test(u)) {
    if (!footer) return null;
    footer.props.returnToTop = false;
    return { kind: "footer", changed: true, touched: footer.id, note: "Turned off the back to top link." };
  }

  return null;
};

export const contentHandlers: Handler[] = [options, links, alerts, fieldTypes, cards, headerFooter];
