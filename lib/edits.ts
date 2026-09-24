/**
 * Direct edits: structural commands Jev's evaluation questions don't cover
 * (move, duplicate, field details, list/nav items, button styles). They are
 * resolved deterministically against the current page — like navigation and
 * undo — and never spend a Jev call. Anything that can't be matched to an
 * element on the page returns null and falls through to Jev.
 *
 * Every phrasing handled here is documented in lib/commands.ts and checked
 * by `pnpm test:commands`.
 */
import { PageSpec, SpecNode, newId } from "./spec";
import {
  DirectEdit, FIELD_TYPES, lastTouched, Handler, TEXT_KEYS, allNodes, cap, cleanSpoken, describe, escapeRe, hrefFor, locate, nodeText, normalize, resolve, spokenList, spokenIndex, tokens, typesIn, unquote, contains,
} from "./edit-helpers";
import { conversationHandlers } from "./edits-conversation";
import { contentHandlers } from "./edits-content";
import { layoutHandlers } from "./edits-layout";

export type { DirectEdit } from "./edit-helpers";
export { cleanSpoken, normalize, FIELD_TYPES } from "./edit-helpers";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** move the hero to the top · move the footer up · put the table after the heading */
const move: Handler = (u, page) => {
  let m = u.match(/^(?:move|put|place|bring|send|drag)\s+(.+?)\s+(?:all the way\s+)?(?:to\s+)?(?:the\s+)?(?:very\s+)?(top|bottom|end|beginning|start)(?:\s+of\s+(?:the\s+)?(?:page|form|section|list))?$/i);
  if (m) {
    const node = resolve(page, m[1]);
    const at = node && locate(page, node.id);
    if (!node || !at) return null;
    at.list.splice(at.index, 1);
    const toTop = /top|beginning|start/i.test(m[2]);
    at.list.splice(toTop ? 0 : at.list.length, 0, node);
    return { kind: "move", changed: true, touched: node.id, note: `Moved ${describe(node)} to the ${toTop ? "top" : "bottom"}.` };
  }
  m = u.match(/^(?:move|put|bring|shift|nudge)\s+(.+?)\s+(up|down|higher|lower)(?:\s+(?:one|a bit|a little|one spot|one place))?$/i);
  if (m) {
    const node = resolve(page, m[1]);
    const at = node && locate(page, node.id);
    if (!node || !at) return null;
    const up = /up|higher/i.test(m[2]);
    const to = at.index + (up ? -1 : 1);
    if (to < 0 || to >= at.list.length) {
      return { kind: "move", changed: false, note: `${describe(node)} is already at the ${up ? "top" : "bottom"}.` };
    }
    [at.list[at.index], at.list[to]] = [at.list[to], at.list[at.index]];
    return { kind: "move", changed: true, touched: node.id, note: `Moved ${describe(node)} ${up ? "up" : "down"}.` };
  }
  m = u.match(/^(?:move|put|place)\s+(.+?)\s+(above|before|over|below|after|under|beneath|underneath)\s+(.+)$/i);
  if (m) {
    const node = resolve(page, m[1]);
    const anchor = resolve(page, m[3]);
    if (!node || !anchor || node.id === anchor.id) return null;
    // "move the form above the save button": the anchor is inside what's moving.
    if (contains(node, anchor.id)) {
      return { kind: "move", changed: false, note: `${describe(anchor)} is inside ${describe(node)}, so it can't move next to it.` };
    }
    const from = locate(page, node.id);
    if (!from) return null;
    from.list.splice(from.index, 1);
    const to = locate(page, anchor.id)!;
    const before = /above|before|over/i.test(m[2]);
    to.list.splice(before ? to.index : to.index + 1, 0, node);
    return { kind: "move", changed: true, touched: node.id, note: `Moved ${describe(node)} ${before ? "above" : "below"} ${describe(anchor)}.` };
  }
  return null;
};

/** duplicate the hero · copy the save button · add another card like apply in one place */
const duplicate: Handler = (u, page) => {
  const m =
    u.match(/^(?:duplicate|copy|clone)\s+(.+?)(?:\s+(?:called|named|titled|that says|saying)\s+(.+))?$/i) ??
    u.match(/^(?:add|make|create)\s+another\s+(.+?)(?:\s+(?:called|named|titled|that says|saying)\s+(.+))?$/i);
  if (!m) return null;
  const phrase = m[1].replace(/\s+(?:like|just like|same as)\s+/i, " ");
  const node = resolve(page, phrase);
  const at = node && locate(page, node.id);
  if (!node || !at) return null;
  const clone = (n: SpecNode): SpecNode => ({
    ...n,
    id: newId(page),
    props: JSON.parse(JSON.stringify(n.props)),
    ...(n.children ? { children: n.children.map(clone) } : {}),
  });
  const copy = clone(node);
  const newText = m[2] && cleanSpoken(m[2]);
  if (newText) {
    const key = TEXT_KEYS.find((k) => typeof copy.props[k] === "string");
    if (key) copy.props[key] = cap(newText);
  }
  at.list.splice(at.index + 1, 0, copy);
  return { kind: "duplicate", changed: true, touched: copy.id, note: `Duplicated ${describe(node)}${newText ? ` as "${cap(newText)}"` : ""}.` };
};

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6" };

/** make phone number required · add a hint to date of birth that says … · set the placeholder for email to … · make the heading an h2 */
const fieldDetails: Handler = (u, page) => {
  // required / optional
  let m =
    u.match(/^(?:make|set|mark)\s+(.+?)\s+(?:as\s+|to\s+)?(?:be\s+)?(required|mandatory|optional|not required)$/i) ??
    u.match(/^(.+?)\s+(?:should be|is)\s+(required|mandatory|optional|not required)$/i);
  if (m) {
    const node = resolve(page, m[1], FIELD_TYPES);
    if (!node) return null;
    const required = /^(required|mandatory)$/i.test(m[2]);
    node.props.required = required;
    return { kind: "field", changed: true, touched: node.id, note: `${describe(node)} is now ${required ? "required" : "optional"}.` };
  }
  // hint / placeholder: "add a hint to X that says Y" or "change the X hint to Y"
  let hint: { which: string; field: string; text: string } | null = null;
  m = u.match(/^(?:add|set|give|put)\s+(?:a\s+|an\s+|the\s+)?(hint|placeholder|help text|helper text)\s+(?:to|for|on)\s+(?:the\s+)?(.+?)\s+(?:that says|saying|to say|that reads|as|to)\s+(.+)$/i);
  if (m) hint = { which: m[1], field: m[2], text: m[3] };
  m = hint ? null : u.match(/^(?:change|update|set)\s+(?:the\s+)?(.+?)\s+(hint|placeholder|help text|helper text)\s+to\s+(?:say\s+)?(.+)$/i);
  if (m) hint = { which: m[2], field: m[1], text: m[3] };
  if (hint) {
    const { which, field: fieldPhrase, text } = hint;
    const node = resolve(page, fieldPhrase, FIELD_TYPES);
    if (!node) return null;
    const key = /placeholder/i.test(which) ? "placeholder" : "hint";
    // Hints read as sentences; placeholders are sample input ("name@example.gov"), left as spoken.
    node.props[key] = key === "hint" ? cap(cleanSpoken(text)) : cleanSpoken(text);
    return { kind: "field", changed: true, touched: node.id, note: `Set the ${key} on ${describe(node)} to "${node.props[key]}".` };
  }
  m = u.match(/^(?:remove|delete|clear|drop)\s+(?:the\s+)?(hint|placeholder|help text)\s+(?:from|on|for)\s+(.+)$/i);
  if (m) {
    const node = resolve(page, m[2], FIELD_TYPES);
    if (!node) return null;
    const key = /placeholder/i.test(m[1]) ? "placeholder" : "hint";
    node.props[key] = null;
    return { kind: "field", changed: true, touched: node.id, note: `Removed the ${key} from ${describe(node)}.` };
  }
  // heading level
  m = u.match(/^(?:make|change|set|turn)\s+(.+?)\s+(?:to\s+|into\s+)?(?:an?\s+)?(?:h|heading level|level|heading)\s*(one|two|three|four|five|six|[1-6])(?:\s+heading)?$/i);
  if (m) {
    const node = resolve(page, m[1], ["Heading"]);
    if (!node) return null;
    const level = `h${NUMBER_WORDS[m[2].toLowerCase()] ?? m[2]}`;
    node.props.level = level;
    return { kind: "field", changed: true, touched: node.id, note: `${describe(node)} is now an ${level.toUpperCase()}.` };
  }
  return null;
};

const NAV_TARGET = "(?:the\\s+)?(?:top\\s+|main\\s+|site\\s+)?(navigation|nav|menu|header|side ?nav(?:igation)?|sidebar|footer|list|bullets|bullet list|cards|card group)(?:\\s+(?:menu|links?|bar))?";

/**
 * add a site header with the navigation home programs check status and sign in · set the navigation to home apply and contact us
 * Replaces the nav items of the header that's already on the page. With no header, returns null so Jev creates one.
 */
const headerNav: Handler = (u, page) => {
  const m =
    u.match(/^(?:add|put|create|give|use|build)\s+(?:it\s+)?(?:a\s+|an\s+|the\s+)?(?:site\s+|top\s+|main\s+)?(?:header|navigation|nav|menu)(?:\s+bar)?\s+with\s+(?:the\s+)?(?:navigation|nav|menu|links?|nav items|menu items|items)?\s*(?:items|links)?\s*(?:for\s+)?(.+)$/i) ??
    u.match(/^(?:set|change|make|update|replace)\s+(?:the\s+)?(?:header\s+)?(?:navigation|nav|menu|nav items|menu items|header links)(?:\s+items|\s+links)?\s+(?:to|with|as)\s+(?:be\s+)?(.+)$/i);
  if (!m) return null;
  const header = resolve(page, "header", ["Header"]);
  const labels = spokenList(m[1]);
  if (!header || !labels.length) return null;
  header.props.navItems = labels.map((l, i) => ({ label: cap(l), href: i === 0 && /^home$/i.test(l) ? "/" : hrefFor(l), current: i === 0, items: null }));
  return { kind: "list", changed: true, touched: header.id, note: `Set the navigation to ${labels.map(cap).join(" · ")}.` };
};

/** add Help to the navigation · add a card called … · remove Programs from the menu */
const listItems: Handler = (u, page) => {
  // cards
  let m = u.match(/^add\s+(?:a\s+|another\s+|one more\s+)?card\s+(?:called|named|titled|that says|saying|for)\s+(.+)$/i);
  if (m) {
    const group = resolve(page, "cards", ["CardGroup"]);
    if (!group) return null;
    const title = cap(unquote(m[1]));
    group.children = [...(group.children ?? []), {
      id: newId(page), type: "Card", props: { title, description: null, headerFirst: null, mediaUrl: null, mediaAlt: null, flag: null },
    }];
    return { kind: "list", changed: true, note: `Added a "${title}" card.` };
  }

  // add X to the nav / side nav / footer / list
  m = u.match(new RegExp(`^add\\s+(?:a\\s+)?(?:(?:link|item|nav item|menu item|bullet)\\s+)?(?:called\\s+|named\\s+|for\\s+)?(.+?)\\s+to\\s+${NAV_TARGET}$`, "i"));
  if (m) {
    const label = cap(unquote(m[1]).replace(/\s+(?:link|item)$/i, ""));
    const where = m[2].toLowerCase();
    if (/side|sidebar/.test(where)) {
      const nav = resolve(page, "side nav", ["SideNav"]);
      if (!nav) return null;
      nav.children = [...(nav.children ?? []), { id: newId(page), type: "Link", props: { label, href: hrefFor(label) } }];
      return { kind: "list", changed: true, note: `Added "${label}" to the side navigation.` };
    }
    if (/footer/.test(where)) {
      const footer = resolve(page, "footer", ["Footer"]);
      const groups = footer?.props.navGroups as Array<{ heading: string | null; links: Array<{ label: string; href: string }> }> | undefined;
      if (!footer || !groups?.length) return null;
      groups[0].links.push({ label, href: hrefFor(label) });
      return { kind: "list", changed: true, note: `Added "${label}" to the footer links.` };
    }
    if (/list|bullet/.test(where)) {
      const list = resolve(page, "list", ["List"]);
      if (!list) return null;
      list.props.items = [...((list.props.items as string[]) ?? []), label];
      return { kind: "list", changed: true, note: `Added "${label}" to the list.` };
    }
    if (/card/.test(where)) return listItems(`add a card called ${label}`, page);
    const header = resolve(page, "header", ["Header"]) ?? resolve(page, "side nav", ["SideNav"]);
    if (!header) return null;
    if (header.type === "SideNav") return listItems(`add ${label} to the side nav`, page);
    header.props.navItems = [...((header.props.navItems as unknown[]) ?? []), { label, href: hrefFor(label), current: false, items: null }];
    return { kind: "list", changed: true, note: `Added "${label}" to the navigation.` };
  }

  // remove X from the nav / side nav / footer / list / cards / table
  m = u.match(new RegExp(`^(?:remove|delete|take out|drop|get rid of)\\s+(?:the\\s+)?(.+?)(?:\\s+(?:link|item|card|column))?\\s+from\\s+${NAV_TARGET}$`, "i"));
  if (m) {
    const label = unquote(m[1]).toLowerCase();
    const where = m[2].toLowerCase();
    const same = (s: unknown) => typeof s === "string" && s.toLowerCase() === label;
    if (/card/.test(where)) {
      const group = resolve(page, "cards", ["CardGroup"]);
      const i = group?.children?.findIndex((c) => same(c.props.title)) ?? -1;
      if (!group || i < 0) return null;
      const [gone] = group.children!.splice(i, 1);
      return { kind: "list", changed: true, note: `Removed the "${gone.props.title}" card.` };
    }
    if (/list|bullet/.test(where)) {
      const list = resolve(page, "list", ["List"]);
      const items = (list?.props.items as string[]) ?? [];
      const i = items.findIndex(same);
      if (!list || i < 0) return null;
      list.props.items = items.filter((_, j) => j !== i);
      return { kind: "list", changed: true, note: `Removed "${items[i]}" from the list.` };
    }
    if (/footer/.test(where)) {
      const footer = resolve(page, "footer", ["Footer"]);
      const groups = (footer?.props.navGroups as Array<{ links: Array<{ label: string }> }>) ?? [];
      for (const g of groups) {
        const i = g.links.findIndex((l) => same(l.label));
        if (i >= 0) {
          const [gone] = g.links.splice(i, 1);
          return { kind: "list", changed: true, note: `Removed "${gone.label}" from the footer.` };
        }
      }
      return null;
    }
    // nav words: try the header first, then the side nav
    const header = resolve(page, "header", ["Header"]);
    const items = (header?.props.navItems as Array<{ label: string }>) ?? [];
    const i = /side|sidebar/.test(where) ? -1 : items.findIndex((it) => same(it.label));
    if (header && i >= 0) {
      header.props.navItems = items.filter((_, j) => j !== i);
      return { kind: "list", changed: true, note: `Removed "${items[i].label}" from the navigation.` };
    }
    const side = resolve(page, "side nav", ["SideNav"]);
    const j = side?.children?.findIndex((c) => same(c.props.label)) ?? -1;
    if (side && j >= 0) {
      const [gone] = side.children!.splice(j, 1);
      return { kind: "list", changed: true, note: `Removed "${gone.props.label}" from the side navigation.` };
    }
    return null;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const columnsOf = (t: SpecNode) => (t.props.columns as string[]) ?? [];
const rowsOf = (t: SpecNode) => (t.props.rows as string[][]) ?? [];

/** "status", "the status column", "column 2", "the last column" → index, or -1. */
function columnIndex(t: SpecNode, phrase: string): number {
  const p = phrase.toLowerCase().trim().replace(/^the\s+/, "").replace(/\s+column$/, "").replace(/^column\s+(?:number\s+)?/, "").trim();
  const cols = columnsOf(t).map((c) => c.toLowerCase());
  const exact = cols.indexOf(p);
  if (exact >= 0) return exact;
  if (p === "last") return cols.length - 1;
  const n = spokenIndex(p);
  if (n !== null) return n < cols.length ? n : -1;
  const want = tokens(p);
  return want.length ? cols.findIndex((c) => want.every((w) => tokens(c).includes(w))) : -1;
}

/** "the SNAP row", "row 2", "the second row", "the last row", "the row for WIC" → index, or -1. */
function rowIndex(t: SpecNode, phrase: string): number {
  const p = phrase.toLowerCase().trim()
    .replace(/^the\s+/, "").replace(/^row\s+(?:for|with)\s+/, "").replace(/\s+row$/, "").replace(/^row\s+(?:number\s+)?/, "").trim();
  const rows = rowsOf(t);
  if (p === "last") return rows.length - 1;
  const n = spokenIndex(p);
  if (n !== null) return n < rows.length ? n : -1;
  const exact = rows.findIndex((r) => r.some((c) => c.toLowerCase() === p));
  if (exact >= 0) return exact;
  const want = tokens(p);
  return want.length ? rows.findIndex((r) => want.every((w) => tokens(r.join(" ")).includes(w))) : -1;
}

/** Column names spoken inline: "program WIC status pending updated May 3" → {0: WIC, 1: pending, 2: May 3}. */
function namedCells(cols: string[], text: string): Map<number, string> | null {
  const found: Array<{ i: number; start: number; end: number }> = [];
  cols.forEach((c, i) => {
    const m = new RegExp(`\\b${escapeRe(c)}\\b(?:\\s+(?:of|as|is|to|should be))?\\s*[:=]?\\s*`, "i").exec(text);
    if (m) found.push({ i, start: m.index, end: m.index + m[0].length });
  });
  if (!found.length || found.sort((a, b) => a.start - b.start)[0].start > 0) return null;
  const cells = new Map<number, string>();
  found.forEach((f, k) => {
    const stop = k + 1 < found.length ? found[k + 1].start : text.length;
    const v = text.slice(f.end, stop).replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/\s+and$/i, "").trim();
    if (v) cells.set(f.i, v);
  });
  return cells.size ? cells : null;
}

/** Cell values for a new row: named ("with status pending"), "for X with …", or positional ("SNAP, approved, May 2"). */
function cellsFrom(t: SpecNode, content: string): string[] {
  const cols = columnsOf(t);
  const out = cols.map(() => "");
  let text = content.trim().replace(/^(?:with|for|containing|that says|saying|of)\s+/i, "");
  let lead: string | null = null;
  const withSplit = text.match(/^(.+?)\s+with\s+(.+)$/i);
  if (withSplit) [lead, text] = [withSplit[1], withSplit[2]];
  const named = namedCells(cols, text);
  if (named) {
    if (lead !== null && !named.has(0)) named.set(0, lead);
    for (const [i, v] of named) out[i] = cap(unquote(v));
    return out;
  }
  const values = text.split(/\s*[,;]\s*|\s+and\s+/i).map(unquote).filter(Boolean);
  const start = lead !== null ? 1 : 0;
  if (lead !== null) out[0] = cap(unquote(lead));
  values.slice(0, cols.length - start).forEach((v, k) => { out[start + k] = cap(v); });
  return out;
}

function sortKey(values: string[]): (v: string) => number | string {
  if (values.every((v) => v.trim() !== "" && !isNaN(Number(v.replace(/[$,%]/g, ""))))) return (v) => Number(v.replace(/[$,%]/g, ""));
  if (values.every((v) => !isNaN(Date.parse(v)))) return (v) => Date.parse(v);
  return (v) => v.toLowerCase();
}

const TABLE_FLAGS: Array<[RegExp, string, boolean]> = [
  [/\bstripe[sd]?\b|\bzebra\b|\balternating\b/i, "striped", true],
  [/\bborderless\b|\bno borders\b|\bwithout borders\b/i, "borderless", true],
  [/\bborders\b|\bbordered\b/i, "borderless", false],
  [/\bcompact\b|\bdense\b|\bcondensed\b/i, "compact", true],
  [/\bscroll(?:able|ing)?\b/i, "scrollable", true],
];

/**
 * add a row with SNAP, approved, May 2 · add a row for WIC with status pending · remove the SNAP row ·
 * change the status of SNAP to denied · add a column called Due date · rename the status column to Decision ·
 * move the status column to the left · sort the table by updated · make the table striped · set the caption to …
 */
const table: Handler = (u, page) => {
  const t = resolve(page, u, ["Table"]) ?? resolve(page, "table", ["Table"]);
  if (!t) return null;
  const cols = columnsOf(t);
  const rows = rowsOf(t);
  const done = (note: string): DirectEdit => ({ kind: "table", changed: true, touched: t.id, note });
  const tableWords = /\btables?\b|\brows?\b|\bcolumns?\b|\bcells?\b|\bcaption\b/i.test(u);
  let m: RegExpMatchArray | null;

  // ---- columns ----
  m = u.match(/^(?:add|insert|create)\s+(?:a\s+|another\s+|one more\s+)?(?:new\s+)?column\s+(?:called|named|for|titled)?\s*(.+?)(?:\s+(?:to|in)\s+(?:the\s+)?table)?$/i);
  if (m) {
    let label = unquote(m[1]);
    let at = cols.length;
    const pos = label.match(/^(.+?)\s+(after|before)\s+(?:the\s+)?(.+?)(?:\s+column)?$/i);
    if (pos && columnIndex(t, pos[3]) >= 0) {
      label = pos[1];
      at = columnIndex(t, pos[3]) + (/after/i.test(pos[2]) ? 1 : 0);
    } else if (/\s+at the (?:start|beginning|front)$/i.test(label)) {
      label = label.replace(/\s+at the (?:start|beginning|front)$/i, "");
      at = 0;
    }
    label = cap(label);
    t.props.columns = [...cols.slice(0, at), label, ...cols.slice(at)];
    t.props.rows = rows.map((r) => [...r.slice(0, at), "", ...r.slice(at)]);
    return done(`Added a "${label}" column${at < cols.length ? ` at position ${at + 1}` : ""}.`);
  }
  m = u.match(/^(?:rename|change|call|retitle)\s+(?:the\s+)?(.+?)\s+column(?:\s+(?:to|as|into))?\s+(.+)$/i);
  if (m && columnIndex(t, m[1]) >= 0) {
    const i = columnIndex(t, m[1]);
    const label = cap(cleanSpoken(m[2]));
    const old = cols[i];
    t.props.columns = cols.map((c, j) => (j === i ? label : c));
    return done(`Renamed the "${old}" column to "${label}".`);
  }
  m = u.match(/^(?:move|shift)\s+(?:the\s+)?(.+?)\s+column\s+(?:to\s+the\s+|all the way\s+)?(left|right|start|beginning|front|end|first|last)$/i);
  if (m && columnIndex(t, m[1]) >= 0) {
    const i = columnIndex(t, m[1]);
    const dir = m[2].toLowerCase();
    const to = dir === "left" ? i - 1 : dir === "right" ? i + 1 : /start|beginning|front|first/.test(dir) ? 0 : cols.length - 1;
    if (to < 0 || to >= cols.length || to === i) return { kind: "table", changed: false, note: `The "${cols[i]}" column is already there.` };
    const reorder = <T,>(arr: T[]) => { const a = [...arr]; const [x] = a.splice(i, 1); a.splice(to, 0, x); return a; };
    t.props.columns = reorder(cols);
    t.props.rows = rows.map(reorder);
    return done(`Moved the "${cols[i]}" column ${dir === "left" || dir === "right" ? dir : `to the ${to === 0 ? "start" : "end"}`}.`);
  }
  m = u.match(/^(?:remove|delete|drop|get rid of)\s+(?:the\s+)?(.+?)\s+column(?:\s+from\s+(?:the\s+)?table)?$/i);
  if (m && columnIndex(t, m[1]) >= 0) {
    const i = columnIndex(t, m[1]);
    t.props.columns = cols.filter((_, j) => j !== i);
    t.props.rows = rows.map((r) => r.filter((_, j) => j !== i));
    return done(`Removed the "${cols[i]}" column.`);
  }

  // ---- rows ----
  m = u.match(/^(?:add|insert|append|put|create)\s+(?:a\s+|an\s+|another\s+|one more\s+)?(?:new\s+)?(?:empty\s+|blank\s+)?row\b(.*)$/i);
  if (m && cols.length) {
    let rest = m[1];
    const top = /\bat the (?:top|beginning|start)\b/i.test(rest);
    rest = rest
      .replace(/\s*\b(?:to|in|on|into)\s+(?:the\s+)?table\b/i, "")
      .replace(/\s*\bat the (?:top|beginning|start|bottom|end)\b/i, "")
      .replace(/^\s*[:,-]\s*/, "")
      .trim();
    const cells = rest ? cellsFrom(t, rest) : cols.map(() => "");
    t.props.rows = top ? [cells, ...rows] : [...rows, cells];
    const filled = cells.filter(Boolean);
    return done(`Added a row${top ? " at the top" : ""}${filled.length ? `: ${filled.join(" · ")}` : " (empty)"}.`);
  }
  m = u.match(/^add\s+(.+?)\s+to\s+(?:the\s+)?table$/i);
  if (m && cols.length) {
    const cells = cellsFrom(t, m[1]);
    t.props.rows = [...rows, cells];
    return done(`Added a row: ${cells.filter(Boolean).join(" · ")}.`);
  }
  if (/^(?:clear|empty)\s+(?:out\s+)?(?:the\s+)?table$|^(?:remove|delete)\s+(?:all\s+(?:of\s+)?(?:the\s+)?|every\s+)rows?\b/i.test(u)) {
    t.props.rows = [];
    return done(`Removed all ${rows.length} rows.`);
  }
  m =
    u.match(/^(?:remove|delete|drop|get rid of|take out)\s+(?:the\s+)?(.+?)\s+from\s+(?:the\s+)?table$/i) ??
    u.match(/^(?:remove|delete|drop|get rid of)\s+(.*\brow\b.*?)(?:\s+from\s+(?:the\s+)?table)?$/i);
  if (m) {
    const c = cols.findIndex((col) => col.toLowerCase() === m![1].toLowerCase().replace(/^the\s+/, "").replace(/\s+column$/, ""));
    if (c >= 0) return table(`remove the ${cols[c]} column`, page);
    // No matching row: fall through ("remove the stripes from the table" is a style edit).
    const r = rowIndex(t, m[1]);
    if (r >= 0) {
      t.props.rows = rows.filter((_, j) => j !== r);
      return done(`Removed row ${r + 1} (${rows[r].filter(Boolean).join(" · ")}).`);
    }
  }
  m = u.match(/^(?:move|shift)\s+(?:the\s+)?(.+?\s+row|row\s+.+?)\s+(?:to\s+the\s+|all the way\s+)?(?:very\s+)?(top|bottom|up|down|first|last)$/i);
  if (m) {
    const r = rowIndex(t, m[1]);
    if (r < 0) return null;
    const dir = m[2].toLowerCase();
    const to = dir === "up" ? r - 1 : dir === "down" ? r + 1 : /top|first/.test(dir) ? 0 : rows.length - 1;
    if (to < 0 || to >= rows.length || to === r) return { kind: "table", changed: false, note: `Row ${r + 1} is already there.` };
    const next = [...rows];
    const [row] = next.splice(r, 1);
    next.splice(to, 0, row);
    t.props.rows = next;
    return done(`Moved row "${row.filter(Boolean).join(" · ")}" ${dir === "up" || dir === "down" ? dir : `to the ${to === 0 ? "top" : "bottom"}`}.`);
  }

  // ---- cells ----
  // "change the status of SNAP to denied", "set the status for row 2 to pending"
  m = u.match(/^(?:change|set|update|make|mark)\s+(?:the\s+)?(.+?)\s+(?:of|for|in|on)\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i);
  if (m && columnIndex(t, m[1]) >= 0 && rowIndex(t, m[2]) >= 0) {
    const [c, r] = [columnIndex(t, m[1]), rowIndex(t, m[2])];
    const value = cap(cleanSpoken(m[3]));
    const old = rows[r][c];
    rows[r][c] = value;
    return done(`Set ${cols[c]} for row ${r + 1} to "${value}"${old ? ` (was "${old}")` : ""}.`);
  }
  // "set SNAP status to denied", "mark row 2's status as approved"
  for (const [c, col] of cols.entries()) {
    m = u.match(new RegExp(`^(?:change|set|update|make|mark)\\s+(?:the\\s+)?(.+?)(?:[’']s)?\\s+${escapeRe(col)}\\s+(?:to|as)\\s+(.+)$`, "i"));
    if (m && rowIndex(t, m[1]) >= 0) {
      const r = rowIndex(t, m[1]);
      const value = cap(cleanSpoken(m[2]));
      const old = rows[r][c];
      rows[r][c] = value;
      return done(`Set ${col} for row ${r + 1} to "${value}"${old ? ` (was "${old}")` : ""}.`);
    }
  }
  // "change approved to denied" — replace a cell's exact text
  m = u.match(/^(?:change|replace|update|switch)\s+(?:the\s+)?(.+?)\s+(?:to|with)\s+(.+)$/i);
  if (m) {
    const from = unquote(m[1]).toLowerCase();
    const value = cap(cleanSpoken(m[2]));
    let count = 0;
    for (const r of rows) r.forEach((cell, j) => { if (cell.toLowerCase() === from) { r[j] = value; count++; } });
    if (count) return done(`Changed ${count} cell${count > 1 ? "s" : ""} from "${m[1]}" to "${value}".`);
  }

  // ---- sort ----
  m = u.match(/^(?:sort|order)\s+(?:the\s+)?(?:table|rows)?\s*(?:by\s+(?:the\s+)?(.+?))?(?:\s+(ascending|descending|a to z|z to a|newest first|oldest first|highest first|lowest first|smallest first|largest first|in reverse|reversed?))?$/i);
  if (m && (m[1] || tableWords)) {
    const c = m[1] ? columnIndex(t, m[1]) : 0;
    if (c < 0) return null;
    const desc = /descending|z to a|newest|highest|largest|reverse/i.test(m[2] ?? "");
    const key = sortKey(rows.map((r) => r[c] ?? ""));
    t.props.rows = [...rows].sort((a, b) => {
      const [x, y] = [key(a[c] ?? ""), key(b[c] ?? "")];
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    return done(`Sorted by ${cols[c]}${desc ? " (descending)" : ""}.`);
  }

  // ---- caption ----
  if (/\bcaption\b/i.test(u)) {
    if (/^(?:remove|delete|clear|drop)\b/i.test(u)) {
      t.props.caption = null;
      return done("Removed the table caption.");
    }
    const text =
      u.match(/\b(?:that says|saying|to say|reading)\s+(.+)$/i)?.[1] ??
      u.match(/\bcaption\s+to\s+(.+)$/i)?.[1] ??
      u.match(/^caption\s+(?:the\s+)?table\s+(.+)$/i)?.[1];
    if (!text) return null;
    t.props.caption = cap(cleanSpoken(text));
    return done(`Set the table caption to "${t.props.caption}".`);
  }

  // ---- style: striped, borderless, compact, scrollable ----
  if (/\btables?\b/i.test(u) && /^(?:make|set|turn|add|remove|use|show|hide|stripe|give)\b/i.test(u)) {
    const changes: string[] = [];
    for (const [re, prop, on] of TABLE_FLAGS) {
      const hit = u.match(re);
      if (!hit) continue;
      if (changes.some((c) => c.startsWith(prop))) continue;
      const before = u.slice(0, hit.index);
      const negated = /\b(?:not|no|non|un|remove|turn off|without|hide|less)\b[\s-]*(?:the\s+)?$/i.test(before) || /^(?:remove|hide)\b/i.test(u);
      const value = negated ? !on : on;
      t.props[prop] = value;
      changes.push(`${prop}: ${value}`);
    }
    if (changes.length) return done(`Table ${changes.join(", ")}.`);
  }
  return null;
};

/** remove the cancel button · delete the phone number field · remove the hero */
const remove: Handler = (u, page) => {
  const m = u.match(/^(?:remove|delete|get rid of|take out|drop)\s+(?:the\s+)?(.+?)(?:\s+from\s+(?:the\s+)?(?:page|form|section|group))?$/i);
  if (!m) return null;
  const node = resolve(page, m[1]);
  if (!node) return null;
  // Most of what was named has to match, so "the application status card"
  // doesn't delete "Check your status anytime" on one shared word.
  const want = tokens(typesIn(m[1]).rest);
  const have = new Set(tokens(nodeText(node)));
  if (want.length && want.filter((t) => have.has(t)).length * 2 < want.length) return null;
  const at = locate(page, node.id);
  if (!at) return null;
  at.list.splice(at.index, 1);
  const inside = node.children?.length ? ` and the ${allNodes(node.children).length} elements inside it` : "";
  return { kind: "remove", changed: true, touched: null, note: `Removed ${describe(node)}${inside}.` };
};

/** Spoken button styles → USWDS variant. Order matters (accent cool before cool, outline inverse before outline). */
const BUTTON_VARIANTS: Array<[RegExp, string]> = [
  [/\baccent[- ]?cool\b|\bcool\b|\bcyan\b|\bteal\b|\blight blue\b/i, "accent-cool"],
  [/\baccent[- ]?warm\b|\bwarm\b|\borange\b|\bgold\b|\byellow\b/i, "accent-warm"],
  [/\bsecondary\b|\bred\b/i, "secondary"],
  [/\boutline[- ]?inverse\b|\binverse\b/i, "outline-inverse"],
  [/\boutlined?\b/i, "outline"],
  [/\bbase\b|\bgr[ae]y\b|\bdark\b/i, "base"],
  [/\bunstyled\b|\bplain\b|\blike a link\b/i, "unstyled"],
  [/\bdefault\b|\bprimary\b|\bblue\b|\bnormal colou?r\b/i, "default"],
];
const COLOR_CYCLE = ["default", "secondary", "accent-cool", "accent-warm", "base"];

/** Style words in an "add a … button" utterance: variant, size, and the label with style words removed. */
export function spokenButtonStyle(text: string): { variant: string; size: "big" | null; label: string } {
  let label = text;
  for (const [re] of BUTTON_VARIANTS) label = label.replace(new RegExp(re.source, "gi"), " ");
  label = label.replace(new RegExp(BIG_RE.source, "gi"), " ").replace(/\s+/g, " ").trim();
  return {
    variant: BUTTON_VARIANTS.find(([re]) => re.test(text))?.[1] ?? "default",
    size: BIG_RE.test(text) ? "big" : null,
    label,
  };
}
const BIG_RE = /\b(?:big|bigger|large|larger|huge)\b/i;
const NORMAL_SIZE_RE = /\b(?:normal|regular|standard|default) size\b|\bsmall(?:er)?\b|\bnot big\b/i;

/** make the save button secondary · make the buttons accent cool · make the save button big · make it normal size */
const buttonStyle: Handler = (u, page) => {
  // "make it red" works when the last thing touched was a button.
  const pronoun = /^(?:make|change|set|turn|switch|style|restyle|use)\s+(?:it|that|this|that one|this one)\b/i.test(u) && !!lastTouched(page, ["Button"]);
  if (!/\bbuttons?\b/i.test(u) && !pronoun) return null;
  // Text edits ("change the save button text to Default") aren't style edits.
  if (/\b(?:text|label|say|says|read|reads|called|named|wording)\b/i.test(u)) return null;
  if (!/^(?:make|change|set|turn|switch|style|restyle|use)\b/i.test(u)) return null;
  const variant = BUTTON_VARIANTS.find(([re]) => re.test(u))?.[1];
  const size = BIG_RE.test(u) ? "big" : NORMAL_SIZE_RE.test(u) ? null : undefined;
  const cycle = !variant && size === undefined && /colou?r|style/i.test(u);
  if (!variant && size === undefined && !cycle) return null;

  // Which buttons? Strip the style words, then resolve what's left.
  let phrase = u.replace(/^(?:make|change|set|turn|switch|style|restyle|use)\s+/i, "");
  for (const [re] of BUTTON_VARIANTS) phrase = phrase.replace(new RegExp(re.source, "gi"), " ");
  phrase = phrase
    .replace(new RegExp(BIG_RE.source, "gi"), " ")
    .replace(new RegExp(NORMAL_SIZE_RE.source, "gi"), " ")
    .replace(/\b(?:the\s+)?(?:colou?r|style|variant|size)\s+(?:of\s+)?/gi, " ")
    .replace(/\b(?:to|into|as|be|an?|and|the)\b/gi, " ");
  const plural = /\bbuttons\b|\ball\b|\bevery\b|\bboth\b/i.test(u);
  let targets: SpecNode[];
  if (plural) {
    // "the form buttons" → buttons inside the form; "all the buttons" → every button.
    // "the save and cancel buttons" → by label; "the form buttons" → inside the form.
    const scopeWords = phrase.replace(/\bbuttons?\b|\ball\b|\bevery\b|\bboth\b/gi, " ").trim();
    const buttons = allNodes(page.nodes).filter((n) => n.type === "Button");
    const want = tokens(scopeWords);
    const named = buttons.filter((b) => tokens(nodeText(b)).some((t) => want.includes(t)));
    const scope = !named.length && want.length ? resolve(page, scopeWords) : null;
    targets = named.length ? named : allNodes(scope ? [scope] : page.nodes).filter((n) => n.type === "Button");
  } else {
    const hit = pronoun ? lastTouched(page, ["Button"]) : resolve(page, phrase, ["Button"]);
    const buttons = allNodes(page.nodes).filter((n) => n.type === "Button");
    targets = hit ? [hit] : buttons.length === 1 ? buttons : [];
  }
  if (!targets.length) return null;

  const changes: string[] = [];
  for (const b of targets) {
    // Legacy specs used variant "big" for size; split it out.
    if (b.props.variant === "big") { b.props.variant = "default"; b.props.size = "big"; }
    const current = String(b.props.variant ?? "default");
    if (variant) b.props.variant = variant;
    else if (cycle) b.props.variant = COLOR_CYCLE[(COLOR_CYCLE.indexOf(current) + 1) % COLOR_CYCLE.length];
    if (size !== undefined) b.props.size = size;
  }
  const v = targets[0].props.variant;
  if (variant || cycle) changes.push(`${v}`);
  if (size !== undefined) changes.push(size === "big" ? "big" : "normal size");
  const who = targets.length === 1 ? describe(targets[0]) : `${targets.length} buttons`;
  return { kind: "style", changed: true, touched: targets[0].id, note: `Made ${who} ${changes.join(", ")}.` };
};

// Order matters: specific commands first; `remove` is last so "remove X from
// the menu / the table" and "remove the hint from …" reach their own handlers.
const HANDLERS: Handler[] = [...conversationHandlers, buttonStyle, table, ...contentHandlers, ...layoutHandlers, move, duplicate, fieldDetails, headerNav, listItems, remove];

/** Try each direct command; null means "not a direct edit — ask Jev". Mutates `page` on success. */
export function applyDirectEdit(utterance: string, page: PageSpec): DirectEdit | null {
  const u = normalize(utterance);
  for (const h of HANDLERS) {
    // A handler that returns null must leave the page as it found it; undo any
    // partial edit so it can't leak into the Jev path and get saved.
    const before = JSON.stringify(page);
    const r = h(u, page);
    if (r) {
      if (r.touched !== undefined) page.lastTouched = r.touched;
      return r;
    }
    if (JSON.stringify(page) !== before) Object.assign(page, JSON.parse(before));
  }
  return null;
}
