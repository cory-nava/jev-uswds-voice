/**
 * Spec model: json-render nodes with stable ids so Jev can refer to
 * "which element does it affect" and we can patch the tree as JSON.
 * The `id` field is stripped before handing the tree to the Renderer.
 */

export interface SpecNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: SpecNode[];
}

export interface PageSpec {
  pageId: string;
  title: string;
  nodes: SpecNode[];
  nextId: number;
}

export function emptyPage(pageId: string, title?: string): PageSpec {
  return { pageId, title: title ?? pageId, nodes: [], nextId: 1 };
}

export function newId(page: PageSpec): string {
  return `n${page.nextId++}`;
}

export interface UIElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

export interface RenderSpec {
  root: string;
  elements: Record<string, UIElement>;
}

/** Convert the id-tagged node tree into the flat element-map format the
 *  json-render Renderer expects: { root, elements: { id: { type, props, children: [ids] } } }. */
export function toRenderSpec(page: PageSpec): RenderSpec {
  const elements: Record<string, UIElement> = {};
  const visit = (n: SpecNode): void => {
    elements[n.id] = {
      type: n.type,
      props: n.props,
      ...(n.children && n.children.length ? { children: n.children.map((c) => c.id) } : {}),
    };
    n.children?.forEach(visit);
  };
  page.nodes.forEach(visit);
  const rootId = "__page_root__";
  elements[rootId] = { type: "Page", props: {}, children: page.nodes.map((n) => n.id) };
  return { root: rootId, elements };
}

function textOf(node: SpecNode): string {
  const p = node.props;
  for (const k of ["heading", "title", "text", "label", "siteName", "agencyName"]) {
    if (typeof p[k] === "string" && p[k]) return (p[k] as string).slice(0, 42);
  }
  return "";
}

/** Human label for Jev's "which element does it affect" question. */
export function labelNode(node: SpecNode): string {
  const t = textOf(node);
  return t ? `${node.id}: ${node.type} ("${t}")` : `${node.id}: ${node.type}`;
}

export function findNode(page: PageSpec, id: string): SpecNode | null {
  const walk = (nodes: SpecNode[]): SpecNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(page.nodes);
}

/** Remove a node by id. Returns true if removed. */
export function removeNode(page: PageSpec, id: string): boolean {
  const walk = (nodes: SpecNode[]): boolean => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) {
      nodes.splice(i, 1);
      return true;
    }
    return nodes.some((n) => n.children && walk(n.children));
  };
  return walk(page.nodes);
}

/** Container components that can receive child nodes. */
export const CONTAINERS = new Set([
  "CardGroup",
  "Form",
  "Accordion",
  "SideNav",
  "ButtonGroup",
  "Grid",
  "Section",
  "List",
  "InPageNavigation",
  "Breadcrumb",
]);
