/** Types for the voice command reference (lib/commands.ts and lib/commands-*.ts). */
import type { PageSpec } from "./spec";

export type CommandVia = "direct" | "routing" | "text" | "jev" | "session";

export interface CommandExample {
  say: string;
  does: string;
}

export interface CommandGroup {
  id: string;
  title: string;
  via: CommandVia;
  summary: string;
  examples: CommandExample[];
  tips?: string[];
  /** Test-only: add whatever these examples need to the fixture page before each one runs. */
  setup?: (page: PageSpec) => void;
  /**
   * Test-only: custom check for each example (required for "session" groups,
   * optional elsewhere). Gets a fresh fixture page (after `setup`).
   */
  check?: (say: string, page: PageSpec) => CheckResult | Promise<CheckResult>;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export const VIA_LABELS: Record<CommandVia, string> = {
  direct: "Instant — matched on the page",
  routing: "Instant — navigation & history",
  text: "Jev picks the target",
  jev: "Jev picks the component",
  session: "Instant — conversation",
};
