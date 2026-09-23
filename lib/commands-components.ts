/**
 * Command groups: adding USWDS components, organized by category. Handled by
 * Jev + lib/jev.ts (shortlistComponents, extractNode). Every one of the 62
 * catalog components appears in at least one example here.
 *
 * Examples are written the way people actually talk — lowercase, filler OK,
 * no colons or quotes, commas only where a pause naturally belongs (a list of
 * sentence-like titles). extractNode itself still understands colons, quotes
 * and commas when a transcript happens to have them.
 */
import type { CommandGroup, CheckResult } from "./command-types";
import type { PageSpec, SpecNode } from "./spec";
import { applyDirectEdit } from "./edits";
import { NAV_RE, UNDO_RE, REDO_RE } from "./intents";
import { shortlistComponents, extractNode } from "./jev";
import { uswdsComponentDefinitions } from "@cdt5058/json-render-uswds/catalog";

type Def = { props: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[] }[] } } } };
const DEFS = uswdsComponentDefinitions as unknown as Record<string, Def>;

/** Which component each example is meant to produce. `CommandExample` (in
 *  lib/command-types.ts, which this file doesn't own) has no `component`
 *  field, so the map lives here instead, keyed by the exact `say` string.
 *  (Report: command-types.ts could grow an optional `component` field to
 *  avoid this indirection.) */
const COMPONENT_BY_SAY: Record<string, string> = {
  // Page structure & layout
  "add the official government banner at the top": "GovBanner",
  "add a hero with the heading track your benefits in one place": "Hero",
  "add a light section for eligibility": "Section",
  "add a three column grid": "Grid",
  "add a divider": "Divider",
  "add the agency identifier for the department of benefits": "Identifier",
  "add a medium footer for benefit tracker": "Footer",
  "add footer navigation with home and about": "FooterNav",
  "add footer contact information for the help desk": "FooterContact",
  "add footer social links": "FooterSocial",
  // Navigation
  "add a site header with the navigation home programs check status and sign in": "Header",
  "add a side nav with overview applications and documents": "SideNav",
  "add a breadcrumb": "Breadcrumb",
  "add an in page navigation for introduction requirements and how to apply": "InPageNavigation",
  "add a skip to main content link": "SkipNav",
  "add a language selector": "LanguageSelector",
  "add a link called learn about eligibility": "Link",
  "add pagination with 5 pages": "Pagination",
  "add a three step process": "StepIndicator",
  // Content & text
  "add a heading that says your applications": "Heading",
  "add a paragraph that says we review every application within ten days": "Text",
  "add a list with bring your id and bring proof of income": "List",
  "add a summary box with the heading before you start": "SummaryBox",
  "add a process list for apply review and decision": "ProcessList",
  "add an icon list for eligibility requirements": "IconList",
  "add a collection for benefits news and program updates": "Collection",
  "add a table of applications with columns program status and updated": "Table",
  "add a single card called upcoming appointments": "Card",
  "add three feature cards apply in one place, check your status anytime, and get text reminders": "CardGroup",
  "add prose content that says this guide explains how benefits work": "Prose",
  "add a tag that says new": "Tag",
  "add an accordion with sections eligibility how to apply and required documents": "Accordion",
  "add an accordion section for eligibility": "AccordionSection",
  // Forms & inputs
  "add a form with fields for full name date of birth and phone number": "Form",
  "add an email input": "Input",
  "add a textarea for comments": "Textarea",
  "add a dropdown with options yes no and not sure": "Select",
  "add a checkbox that says i agree to the terms": "Checkbox",
  "add a checkbox group with options technology science and health": "CheckboxGroup",
  "add a radio button group with options yes no and not sure": "Radio",
  "add a file upload for documents": "FileInput",
  "add a search bar": "Search",
  "add a range slider for satisfaction": "RangeInput",
  "add a date of birth field": "DateInputGroup",
  "add a date range picker": "DateRangePicker",
  "add a phone number mask": "InputMask",
  "add a password field": "Password",
  "add a combo box with options apple banana and cherry": "ComboBox",
  "add a date picker for start date": "DatePicker",
  "add a time picker for appointment time": "TimePicker",
  "add a character count for a brief description": "CharacterCount",
  "add an input group for amount with a dollar sign": "InputGroup",
  "add a big accent cool apply button": "Button",
  "add a button group with save and cancel": "ButtonGroup",
  // Feedback & status
  "add an error alert that says your session has expired": "Alert",
  "add a site alert that says offices are closed monday": "SiteAlert",
  "add a validation checklist for password requirements": "ValidationChecklist",
  "add a tooltip for the case number field": "Tooltip",
  "add a modal with the heading leave this page and the description your changes will be lost": "Modal",
  // Media & embeds
  "add an embedded video": "EmbedContainer",
  "add a check icon": "Icon",
  "add a graphic list for our values": "GraphicList",
};

/** Does `props` (and any children, recursively) pass the real catalog schema? */
function schemaError(type: string, props: Record<string, unknown>, children?: SpecNode[]): string | null {
  const def = DEFS[type];
  if (!def) return `no catalog definition for ${type}`;
  const result = def.props.safeParse(props);
  if (!result.success) return `${type} props invalid: ${result.error!.issues.map((i) => i.path.join(".")).join(", ")}`;
  for (const child of children ?? []) {
    const err = schemaError(child.type, child.props, child.children);
    if (err) return err;
  }
  return null;
}

/** Shared check for every group here: (a) the utterance reaches Jev — no
 *  direct edit and no nav/undo/redo match — (b) the mapped component is on
 *  Jev's shortlist for it, (c) extractNode's props (children included) pass
 *  the component's real zod schema, (d) spoken copy lands in the node. */
function addCheck(say: string, page: PageSpec): CheckResult {
  const component = COMPONENT_BY_SAY[say];
  if (!component) return { ok: false, detail: "no component mapped — add it to COMPONENT_BY_SAY" };
  const direct = applyDirectEdit(say, page);
  if (direct) return { ok: false, detail: `claimed by a direct edit: ${direct.note}` };
  const trimmed = say.trim();
  if (NAV_RE.test(trimmed) || UNDO_RE.test(trimmed) || REDO_RE.test(trimmed)) {
    return { ok: false, detail: "claimed by routing (nav/undo/redo)" };
  }
  const shortlist = shortlistComponents(say);
  if (!shortlist.includes(component)) return { ok: false, detail: `${component} not shortlisted: ${shortlist.join(", ")}` };
  const { props, children } = extractNode(component, say, page);
  const err = schemaError(component, props, children);
  if (err) return { ok: false, detail: err };
  const missing = missingCopy(say, { props, children });
  if (missing) return { ok: false, detail: `spoken copy "${missing}" didn't make it into the ${component}` };
  return { ok: true, detail: `→ Jev; shortlisted; ${component} props valid; spoken copy kept` };
}

/**
 * (d) Copy spoken after "that says", "called", "with the heading", … must land
 * in the built node (props or children), not fall back to a placeholder.
 * Returns the missing phrase, or null.
 */
function missingCopy(say: string, built: unknown): string | null {
  const cue = say.match(/\b(?:that says|saying|called|titled|named|with the (?:heading|headline|title|text|message|description))\s+(.+?)(?=\s+and\s+the\s+|$)/i);
  if (!cue) return null;
  const words = cue[1].toLowerCase().split(/\s+/).slice(0, 2).join(" ");
  return JSON.stringify(built).toLowerCase().includes(words) ? null : words;
}

/** The fixture already has a Header, and a direct edit now replaces an
 *  existing header's nav items instead of calling Jev (lib/edits.ts
 *  headerNav) — drop it so this group's Header example tests creation. */
const dropHeader = (page: PageSpec) => {
  page.nodes = page.nodes.filter((n) => n.type !== "Header");
};

export const componentGroups: CommandGroup[] = [
  {
    id: "add-layout",
    title: "Add: page structure & layout",
    via: "jev",
    summary: "Describe what you want; Jev picks the USWDS component and where it goes. Listed or quoted words become the content.",
    examples: [
      { say: "add the official government banner at the top", does: "GovBanner, prepended" },
      { say: "add a hero with the heading track your benefits in one place", does: "Hero with that headline" },
      { say: "add a light section for eligibility", does: "Section, light variant" },
      { say: "add a three column grid", does: "Grid with 3 columns" },
      { say: "add a divider", does: "Divider" },
      { say: "add the agency identifier for the department of benefits", does: "Identifier footer block" },
      { say: "add a medium footer for benefit tracker", does: "Footer" },
      { say: "add footer navigation with home and about", does: "FooterNav with two links" },
      { say: "add footer contact information for the help desk", does: "FooterContact block" },
      { say: "add footer social links", does: "FooterSocial links" },
    ],
    tips: ["Say a list of items after a cue word (\"navigation\", \"options\", \"sections\", \"columns\") — with or without commas."],
    check: addCheck,
  },
  {
    id: "add-navigation",
    title: "Add: navigation",
    via: "jev",
    summary: "Headers, side nav, breadcrumbs, pagination, and other ways to move around the site.",
    examples: [
      { say: "add a site header with the navigation home programs check status and sign in", does: "Header with four nav items" },
      { say: "add a side nav with overview applications and documents", does: "SideNav with three links" },
      { say: "add a breadcrumb", does: "Breadcrumb trail" },
      { say: "add an in page navigation for introduction requirements and how to apply", does: "InPageNavigation with jump links" },
      { say: "add a skip to main content link", does: "SkipNav" },
      { say: "add a language selector", does: "LanguageSelector" },
      { say: "add a link called learn about eligibility", does: "Link \"Learn about eligibility\"" },
      { say: "add pagination with 5 pages", does: "Pagination" },
      { say: "add a three step process", does: "StepIndicator with 3 steps" },
    ],
    setup: dropHeader,
    check: addCheck,
  },
  {
    id: "add-content",
    title: "Add: content & text",
    via: "jev",
    summary: "Headings, paragraphs, lists, cards, tables, and other ways to show content.",
    examples: [
      { say: "add a heading that says your applications", does: "Heading \"Your applications\"" },
      { say: "add a paragraph that says we review every application within ten days", does: "Text with that sentence" },
      { say: "add a list with bring your id and bring proof of income", does: "List with two items" },
      { say: "add a summary box with the heading before you start", does: "SummaryBox titled \"Before you start\"" },
      { say: "add a process list for apply review and decision", does: "ProcessList with 3 steps" },
      { say: "add an icon list for eligibility requirements", does: "IconList" },
      { say: "add a collection for benefits news and program updates", does: "Collection" },
      { say: "add a table of applications with columns program status and updated", does: "Table with three columns" },
      { say: "add a single card called upcoming appointments", does: "Card titled \"Upcoming appointments\"" },
      { say: "add three feature cards apply in one place, check your status anytime, and get text reminders", does: "CardGroup with three cards" },
      { say: "add prose content that says this guide explains how benefits work", does: "Prose wrapper with that text" },
      { say: "add a tag that says new", does: "Tag \"New\"" },
      { say: "add an accordion with sections eligibility how to apply and required documents", does: "Accordion with three sections" },
      { say: "add an accordion section for eligibility", does: "AccordionSection" },
    ],
    check: addCheck,
  },
  {
    id: "add-forms",
    title: "Add: forms & inputs",
    via: "jev",
    summary: "Form containers and every kind of input, from a plain text field to date pickers and masks.",
    examples: [
      { say: "add a form with fields for full name date of birth and phone number", does: "Form with three fields" },
      { say: "add an email input", does: "Input, type email" },
      { say: "add a textarea for comments", does: "Textarea" },
      { say: "add a dropdown with options yes no and not sure", does: "Select with three options" },
      { say: "add a checkbox that says i agree to the terms", does: "Checkbox \"I agree to the terms\"" },
      { say: "add a checkbox group with options technology science and health", does: "CheckboxGroup with three options" },
      { say: "add a radio button group with options yes no and not sure", does: "Radio with three options" },
      { say: "add a file upload for documents", does: "FileInput" },
      { say: "add a search bar", does: "Search" },
      { say: "add a range slider for satisfaction", does: "RangeInput" },
      { say: "add a date of birth field", does: "DateInputGroup" },
      { say: "add a date range picker", does: "DateRangePicker" },
      { say: "add a phone number mask", does: "InputMask, phone preset" },
      { say: "add a password field", does: "Password" },
      { say: "add a combo box with options apple banana and cherry", does: "ComboBox with three options" },
      { say: "add a date picker for start date", does: "DatePicker" },
      { say: "add a time picker for appointment time", does: "TimePicker" },
      { say: "add a character count for a brief description", does: "CharacterCount" },
      { say: "add an input group for amount with a dollar sign", does: "InputGroup with a $ prefix" },
      { say: "add a big accent cool apply button", does: "Button \"Apply\", accent-cool, big" },
      { say: "add a button group with save and cancel", does: "ButtonGroup with two buttons" },
    ],
    check: addCheck,
  },
  {
    id: "add-feedback",
    title: "Add: feedback & status",
    via: "jev",
    summary: "Alerts, checklists, tooltips, and modals for telling people what's going on.",
    examples: [
      { say: "add an error alert that says your session has expired", does: "Alert, error type" },
      { say: "add a site alert that says offices are closed monday", does: "SiteAlert with that message" },
      { say: "add a validation checklist for password requirements", does: "ValidationChecklist" },
      { say: "add a tooltip for the case number field", does: "Tooltip" },
      { say: "add a modal with the heading leave this page and the description your changes will be lost", does: "Modal with heading and description" },
    ],
    check: addCheck,
  },
  {
    id: "add-media",
    title: "Add: media & embeds",
    via: "jev",
    summary: "Icons, image+text blocks, and embedded video.",
    examples: [
      { say: "add an embedded video", does: "EmbedContainer" },
      { say: "add a check icon", does: "Icon" },
      { say: "add a graphic list for our values", does: "GraphicList" },
    ],
    check: addCheck,
  },
];
