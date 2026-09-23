/**
 * Layout edits: grouping elements into containers (button groups, grids,
 * sections) and moving elements into or out of an existing container.
 * Documented in lib/commands-layout.ts.
 */
import { PageSpec, SpecNode, newId, CONTAINERS } from "./spec";
import { Handler, allNodes, describe, locate, resolve, spokenIndex, tokens } from "./edit-helpers";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** "the save and cancel buttons" -> the Save button + the Cancel button, each resolved on its own. */
function resolveGroupTargets(page: PageSpec, phrase: string): SpecNode[] | null {
  const parts = phrase.split(/\s*,\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const seen = new Set<string>();
  const nodes: SpecNode[] = [];
  for (const part of parts) {
    const n = resolve(page, part);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  }
  return nodes.length ? nodes : null;
}

function sortByDocOrder(page: PageSpec, nodes: SpecNode[]): SpecNode[] {
  const order = new Map<string, number>();
  allNodes(page.nodes).forEach((n, i) => order.set(n.id, i));
  return [...nodes].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The node whose `children` array is exactly `list` (its "owner" container). */
function ownerNodeOf(page: PageSpec, list: SpecNode[]): SpecNode | null {
  const search = (nodes: SpecNode[]): SpecNode | null => {
    for (const n of nodes) {
      if (n.children === list) return n;
      if (n.children) {
        const hit = search(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return search(page.nodes);
}

/** Remove any container left with no children after elements were moved out of it. */
function pruneEmptyContainers(page: PageSpec, lists: Iterable<SpecNode[]>): void {
  for (const list of lists) {
    if (list === page.nodes || list.length !== 0) continue;
    const owner = ownerNodeOf(page, list);
    const at = owner && locate(page, owner.id);
    if (at) at.list.splice(at.index, 1);
  }
}

/**
 * Remove `nodes` from wherever they currently live and wrap them in a new
 * container, inserted where the first one (in document order) used to be.
 * If that leaves their old parent with no other children, the new container
 * takes its place outright instead of nesting inside it.
 */
function wrapNodes(page: PageSpec, sorted: SpecNode[], type: string, props: Record<string, unknown>): SpecNode | null {
  const first = sorted[0];
  const firstLoc = locate(page, first.id);
  if (!firstLoc) return null;
  const insertList = firstLoc.list;
  const insertIndex = firstLoc.index;
  const touchedLists = new Set<SpecNode[]>();
  for (const n of sorted) {
    const loc = locate(page, n.id);
    if (loc) {
      loc.list.splice(loc.index, 1);
      touchedLists.add(loc.list);
    }
  }
  const container: SpecNode = { id: newId(page), type, props, children: sorted };
  touchedLists.delete(insertList);
  if (insertList !== page.nodes && insertList.length === 0) {
    const owner = ownerNodeOf(page, insertList);
    const at = owner && locate(page, owner.id);
    if (at) {
      at.list.splice(at.index, 1, container);
      pruneEmptyContainers(page, touchedLists);
      return container;
    }
  }
  insertList.splice(insertIndex, 0, container);
  pruneEmptyContainers(page, touchedLists);
  return container;
}

// ---------------------------------------------------------------------------
// Wrap named elements in a brand-new container
// ---------------------------------------------------------------------------

const CONTAINER_WORDS: Record<string, string> = {
  "button group": "ButtonGroup",
  "card group": "CardGroup",
  section: "Section",
};

function containerProps(type: string): Record<string, unknown> {
  switch (type) {
    case "ButtonGroup":
      return { segmented: false };
    case "Section":
      return { title: null, text: null, variant: null };
    default:
      return {};
  }
}

/** put the save and cancel buttons in a button group · wrap the heading and the form in a section */
const wrapInContainer: Handler = (u, page) => {
  const m = u.match(/^(?:put|move|group|combine|wrap)\s+(.+?)\s+(?:in|into)\s+an?\s+(button group|card group|section)$/i);
  if (!m) return null;
  const type = CONTAINER_WORDS[m[2].toLowerCase()];
  if (!type) return null;
  const targets = resolveGroupTargets(page, m[1]);
  if (!targets) return null;
  const sorted = sortByDocOrder(page, targets);
  const container = wrapNodes(page, sorted, type, containerProps(type));
  if (!container) return null;
  return {
    kind: "layout",
    changed: true,
    touched: container.id,
    note: `Put ${sorted.map(describe).join(" and ")} in a new ${m[2].toLowerCase()}.`,
  };
};

// ---------------------------------------------------------------------------
// Columns / grids
// ---------------------------------------------------------------------------

function columnsFromWord(word: string): number | null {
  const n = spokenIndex(word);
  return n === null ? null : n + 1;
}

/**
 * put the cards in three columns · make the cards a three column grid ·
 * put the phone number and email fields side by side
 */
const gridColumns: Handler = (u, page) => {
  let phrase: string | null = null;
  let cols: number | null = null;

  let m = u.match(/^(?:put|arrange|line up|lay out)\s+(.+?)\s+(?:in|into)\s+([a-z0-9]+)\s+columns?$/i);
  if (m) {
    phrase = m[1];
    cols = columnsFromWord(m[2]);
  }
  if (!phrase) {
    m = u.match(/^make\s+(.+?)\s+(?:a|into an?)\s+([a-z0-9]+)[- ]columns?\s+grid$/i);
    if (m) {
      phrase = m[1];
      cols = columnsFromWord(m[2]);
    }
  }
  if (!phrase) {
    m = u.match(/^(?:put|arrange|line up|move)\s+(.+?)\s+side by side$/i);
    if (m) {
      phrase = m[1];
      cols = 2;
    }
  }
  if (!phrase || !cols) return null;
  cols = Math.max(1, Math.min(12, cols));

  const targets = resolveGroupTargets(page, phrase);
  if (!targets) return null;

  // A single named container ("the cards") becomes the grid itself.
  if (targets.length === 1 && CONTAINERS.has(targets[0].type) && targets[0].children?.length) {
    const node = targets[0];
    const count = node.children!.length;
    node.type = "Grid";
    node.props = { columns: cols, gap: "md" };
    return { kind: "layout", changed: true, touched: node.id, note: `Arranged ${count} items in ${cols} columns.` };
  }

  const sorted = sortByDocOrder(page, targets);
  const grid = wrapNodes(page, sorted, "Grid", { columns: cols, gap: "md" });
  if (!grid) return null;
  return {
    kind: "layout",
    changed: true,
    touched: grid.id,
    note: `Put ${sorted.map(describe).join(" and ")} in ${cols} columns.`,
  };
};

// ---------------------------------------------------------------------------
// Move into / out of an existing container
// ---------------------------------------------------------------------------

/** move the save and cancel buttons into the form */
const moveInto: Handler = (u, page) => {
  const m = u.match(/^(?:move|put)\s+(.+?)\s+into\s+the\s+(.+)$/i);
  if (!m) return null;
  const target = resolve(page, m[2]);
  if (!target || !CONTAINERS.has(target.type)) return null;
  const targets = resolveGroupTargets(page, m[1]);
  if (!targets) return null;
  const items = targets.filter((n) => n.id !== target.id);
  if (!items.length) return null;
  const sorted = sortByDocOrder(page, items);
  const touchedLists = new Set<SpecNode[]>();
  for (const n of sorted) {
    const loc = locate(page, n.id);
    if (loc) {
      loc.list.splice(loc.index, 1);
      touchedLists.add(loc.list);
    }
  }
  if (target.children) touchedLists.delete(target.children);
  pruneEmptyContainers(page, touchedLists);
  target.children = [...(target.children ?? []), ...sorted];
  return {
    kind: "layout",
    changed: true,
    touched: sorted[sorted.length - 1].id,
    note: `Moved ${sorted.map(describe).join(" and ")} into ${describe(target)}.`,
  };
};

/** take the cancel button out of the form */
const moveOutOf: Handler = (u, page) => {
  const m = u.match(/^(?:take|move|pull)\s+(.+?)\s+out of\s+(?:the\s+)?(.+)$/i);
  if (!m) return null;
  const container = resolve(page, m[2]);
  if (!container || !CONTAINERS.has(container.type) || !container.children?.length) return null;
  const targets = resolveGroupTargets(page, m[1]);
  if (!targets) return null;
  const insideIds = new Set(allNodes(container.children).map((n) => n.id));
  const items = targets.filter((n) => n.id !== container.id && insideIds.has(n.id));
  if (!items.length) return null;
  const sorted = sortByDocOrder(page, items);
  const touchedLists = new Set<SpecNode[]>();
  for (const n of sorted) {
    const loc = locate(page, n.id);
    if (loc) {
      loc.list.splice(loc.index, 1);
      touchedLists.add(loc.list);
    }
  }
  pruneEmptyContainers(page, touchedLists);
  const at = locate(page, container.id);
  if (!at) return null;
  at.list.splice(at.index + 1, 0, ...sorted);
  return {
    kind: "layout",
    changed: true,
    touched: sorted[sorted.length - 1].id,
    note: `Took ${sorted.map(describe).join(" and ")} out of ${describe(container)}; placed right after it.`,
  };
};

// ---------------------------------------------------------------------------
// Ungroup
// ---------------------------------------------------------------------------

const GROUP_TYPE_WORDS: Array<[RegExp, string]> = [
  [/\bbutton group\b|\bbuttons\b/i, "ButtonGroup"],
  [/\bgrid\b|\bcolumns?\b/i, "Grid"],
  [/\bsection\b/i, "Section"],
  [/\bcard group\b|\bcards\b/i, "CardGroup"],
];

/** The container of `type` best matching `phrase` (by name overlap with its own or its children's text), or the only one. */
function resolveContainer(page: PageSpec, phrase: string, type: string): SpecNode | null {
  const nodes = allNodes(page.nodes).filter((n) => n.type === type);
  if (nodes.length <= 1) return nodes[0] ?? null;
  const want = tokens(phrase);
  if (!want.length) return nodes[0];
  const hasWord = (n: SpecNode) => {
    const hay = tokens([n, ...(n.children ?? [])].map((c) => Object.values(c.props).filter((v) => typeof v === "string").join(" ")).join(" "));
    return want.some((t) => hay.includes(t));
  };
  return nodes.find(hasWord) ?? nodes[0];
}

/** ungroup the buttons · unwrap the section */
const ungroup: Handler = (u, page) => {
  const m = u.match(/^(?:ungroup|unwrap|un-?group)\s+(?:the\s+)?(.+)$/i);
  if (!m) return null;
  const wordHit = GROUP_TYPE_WORDS.find(([re]) => re.test(m[1]));
  const node = wordHit ? resolveContainer(page, m[1], wordHit[1]) : resolve(page, m[1]);
  if (!node || !CONTAINERS.has(node.type) || !node.children?.length) return null;
  const at = locate(page, node.id);
  if (!at) return null;
  const kids = node.children;
  at.list.splice(at.index, 1, ...kids);
  return {
    kind: "layout",
    changed: true,
    touched: kids[0]?.id ?? null,
    note: `Ungrouped ${describe(node)}; its ${kids.length} elements are now direct children where it was.`,
  };
};

// Order matters: the more specific "move into/out of an existing container"
// and "ungroup" phrasings first, then the general wrap/columns commands.
export const layoutHandlers: Handler[] = [ungroup, moveInto, moveOutOf, wrapInContainer, gridColumns];
