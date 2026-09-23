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
import type { PageSpec } from "./spec";
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

/** Render a voice-built page spec as live USWDS markup. */
export function SpecCanvas({ page }: { page: PageSpec }) {
  const spec = toRenderSpec(page) as unknown as Parameters<typeof Renderer>[0]["spec"];
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}
