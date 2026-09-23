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

const catalog = defineCatalog(schema, {
  actions: {},
  components: {
    ...uswdsComponentDefinitions,
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
