"use client";
/**
 * Client-side json-render registry: the USWDS catalog plus a synthetic
 * "Page" root node (renders children in a fragment).
 */
import React from "react";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { defineRegistry, Renderer, JSONUIProvider } from "@json-render/react";
import { uswdsComponents } from "@cdt5058/json-render-uswds";
import { uswdsComponentDefinitions } from "@cdt5058/json-render-uswds/catalog";
import type { PageSpec, SpecNode } from "./spec";
import { toRenderSpec } from "./spec";

const VARIANT_CLASS: Record<string, string> = {
  secondary: "usa-button--secondary",
  "accent-cool": "usa-button--accent-cool",
  "accent-warm": "usa-button--accent-warm",
  base: "usa-button--base",
  outline: "usa-button--outline",
  "outline-inverse": "usa-button--outline usa-button--inverse",
  big: "usa-button--big",
  unstyled: "usa-button--unstyled",
};

/** Button with an independent `size` so a button can be both big and colored
 *  (the library folds "big" into `variant`, which makes them exclusive), and
 *  an optional `href` so a button can act as a link ("link the apply button
 *  to slash apply") — renders an `<a className="usa-button …">` instead of
 *  a `<button>` when set. */
function Button({
  props,
  emit,
}: {
  props: {
    label: string;
    variant?: string | null;
    size?: string | null;
    disabled?: boolean | null;
    type?: "button" | "submit" | "reset" | null;
    href?: string | null;
  };
  emit: (e: string) => void;
}) {
  const classes = ["usa-button", VARIANT_CLASS[props.variant ?? ""], props.size === "big" ? "usa-button--big" : null].filter(Boolean);
  const className = [...new Set(classes)].join(" ");
  if (props.href && !/^\s*javascript:/i.test(props.href)) {
    return (
      <a className={className} href={props.href} onClick={() => emit("press")}>
        {props.label}
      </a>
    );
  }
  return (
    <button type={props.type ?? "button"} className={className} disabled={props.disabled ?? false} onClick={() => emit("press")}>
      {props.label}
    </button>
  );
}

const catalog = defineCatalog(schema, {
  actions: {},
  components: {
    ...uswdsComponentDefinitions,
    Button: {
      ...uswdsComponentDefinitions.Button,
      props: uswdsComponentDefinitions.Button.props.extend({
        size: z.enum(["big"]).nullable().optional(),
        href: z.string().nullable().optional(),
      }),
    },
    Page: {
      props: z.object({}),
      description: "Page root — renders children in a fragment.",
      example: { type: "Page", props: {}, children: [] },
    },
  } as typeof uswdsComponentDefinitions,
});

const { registry } = defineRegistry(catalog, {
  components: {
    ...uswdsComponents,
    Button,
    Page: (p: { children?: React.ReactNode }) => <>{p.children}</>,
  } as typeof uswdsComponents,
});

/** Site chrome that always renders full width: banner/header on top, footer at the bottom. */
const TOP_CHROME = ["SkipNav", "GovBanner", "SiteAlert", "Header"];
const BOTTOM_CHROME = ["Footer", "Identifier"];
/** Full-width sections that sit in <main> but outside the centered container. */
const FULL_BLEED = new Set(["Hero"]);

export interface PageLayout {
  top: SpecNode[];
  /** Runs of main content, in order: full-bleed sections, or contained groups (with an optional side nav column). */
  main: Array<{ kind: "bleed"; nodes: SpecNode[] } | { kind: "contained"; sideNav: SpecNode | null; nodes: SpecNode[] }>;
  bottom: SpecNode[];
}

/**
 * Arrange a page the way USWDS sites are built: banner and header first (in
 * canonical order, whatever order they were spoken in), footer last, and the
 * rest in a centered grid container, with the side nav in a narrow column
 * beside its content.
 */
export function layoutPage(page: PageSpec): PageLayout {
  const rank = (list: string[]) => (n: SpecNode) => list.indexOf(n.type);
  const top = page.nodes.filter((n) => TOP_CHROME.includes(n.type)).sort((a, b) => rank(TOP_CHROME)(a) - rank(TOP_CHROME)(b));
  const bottom = page.nodes.filter((n) => BOTTOM_CHROME.includes(n.type)).sort((a, b) => rank(BOTTOM_CHROME)(a) - rank(BOTTOM_CHROME)(b));
  const main: PageLayout["main"] = [];
  for (const n of page.nodes) {
    if (TOP_CHROME.includes(n.type) || BOTTOM_CHROME.includes(n.type)) continue;
    const last = main[main.length - 1];
    if (FULL_BLEED.has(n.type)) main.push({ kind: "bleed", nodes: [n] });
    else if (last?.kind === "contained") last.nodes.push(n);
    else main.push({ kind: "contained", sideNav: null, nodes: [n] });
  }
  for (const run of main) {
    if (run.kind !== "contained") continue;
    const i = run.nodes.findIndex((n) => n.type === "SideNav");
    if (i >= 0) [run.sideNav] = run.nodes.splice(i, 1);
  }
  return { top, main, bottom };
}

function Nodes({ page, nodes }: { page: PageSpec; nodes: SpecNode[] }) {
  if (!nodes.length) return null;
  const spec = toRenderSpec({ ...page, nodes }) as unknown as Parameters<typeof Renderer>[0]["spec"];
  return <Renderer spec={spec} registry={registry} />;
}

/** Render a voice-built page spec as live USWDS markup. */
export function SpecCanvas({ page }: { page: PageSpec }) {
  const { top, main, bottom } = layoutPage(page);
  return (
    <JSONUIProvider registry={registry}>
      <Nodes page={page} nodes={top} />
      <main id="main-content">
        {main.map((run, i) =>
          run.kind === "bleed" ? (
            <Nodes key={i} page={page} nodes={run.nodes} />
          ) : (
            <section key={i} className="grid-container usa-section">
              {run.sideNav ? (
                <div className="grid-row grid-gap-lg">
                  <div className="desktop:grid-col-3 margin-bottom-4">
                    <Nodes page={page} nodes={[run.sideNav]} />
                  </div>
                  <div className="desktop:grid-col-9 usa-prose">
                    <Nodes page={page} nodes={run.nodes} />
                  </div>
                </div>
              ) : (
                <div className="usa-prose">
                  <Nodes page={page} nodes={run.nodes} />
                </div>
              )}
            </section>
          ),
        )}
      </main>
      <Nodes page={page} nodes={bottom} />
    </JSONUIProvider>
  );
}
