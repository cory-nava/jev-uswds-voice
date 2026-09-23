/**
 * The voice command reference: every supported kind of utterance, with
 * example phrasings. Single source of truth for the /commands page, and
 * `pnpm test:commands` runs every example through the real parsers so this
 * list can't drift from what the app actually understands.
 *
 * Groups live in this file (core edits) and in lib/commands-*.ts
 * (components, content, layout & pages, conversation); COMMAND_GROUPS
 * assembles them in reading order.
 *
 * `via` says who decides:
 *   - "direct":  lib/edits.ts, matched against the current page (no Jev call)
 *   - "routing": lib/intents.ts, navigation and undo/redo (no Jev call)
 *   - "text":    Jev picks the target; the new words come from the transcript
 *   - "jev":     Jev's evaluation questions choose the component and placement
 */

import type { CommandGroup } from "./command-types";
import { componentGroups } from "./commands-components";
import { contentGroups } from "./commands-content";
import { layoutGroups } from "./commands-layout";
import { conversationGroups } from "./commands-conversation";

export type { CommandVia, CommandExample, CommandGroup, CheckResult } from "./command-types";
export { VIA_LABELS } from "./command-types";

const CORE: Record<string, CommandGroup> = Object.fromEntries(([
  {
    id: "text",
    title: "Change text",
    via: "text",
    summary: "Say the old words and the new ones, or name the element and what it should say.",
    examples: [
      { say: "change full name to full legal name", does: "Renames the \"Full name\" field label" },
      { say: "okay let's change full name to just be first name", does: "Label → \"First name\" (filler dropped)" },
      { say: "can we change the text input from full name to say full legal name", does: "Same, with filler words" },
      { say: "change the hero heading to Track your application status", does: "Hero headline" },
      { say: "change the body of the hero to We update this every hour", does: "Hero supporting paragraph" },
      { say: "make the back button say go home", does: "Button label → \"Go home\"" },
      { say: "rename the phone number field to mobile phone", does: "Field label" },
    ],
    tips: ["Matching the existing words exactly (ignoring case) is the most reliable way to target something."],
  },
  {
    id: "button-style",
    title: "Button styles & size",
    via: "direct",
    summary: "USWDS button variants by name or color, plus big / normal size. Works on one button, a list of buttons, or all of them.",
    examples: [
      { say: "make the save button secondary", does: "variant: secondary (red)" },
      { say: "make the cancel button accent cool", does: "variant: accent-cool" },
      { say: "make the save button accent warm", does: "variant: accent-warm" },
      { say: "change the save button back to default", does: "variant: default (primary blue)" },
      { say: "make the cancel button outline", does: "variant: outline" },
      { say: "make the save button big", does: "size: big (keeps its color)" },
      { say: "make the save button normal size", does: "size: normal" },
      { say: "make the save and cancel buttons big and red", does: "Both buttons: secondary + big" },
      { say: "make all the buttons base", does: "Every button: base (gray)" },
      { say: "change the color of the save button", does: "Steps to the next color" },
    ],
    tips: [
      "Colors: default/primary/blue · secondary/red · accent cool/cyan/teal · accent warm/orange/gold · base/gray · outline · inverse · unstyled.",
    ],
  },
  {
    id: "move",
    title: "Move & reorder",
    via: "direct",
    summary: "Move a section (or an item inside a form or group) to the top/bottom, up/down one spot, or next to something else.",
    examples: [
      { say: "move the hero to the top", does: "First on the page" },
      { say: "move the footer up", does: "Swap with the section above" },
      { say: "move the save button down", does: "Reorders within its button group" },
      { say: "put the table below the heading", does: "Directly after the heading" },
      { say: "move the cards above the hero", does: "Directly before the hero" },
    ],
  },
  {
    id: "duplicate",
    title: "Duplicate",
    via: "direct",
    summary: "Copy a section or element right after the original, optionally with new text.",
    examples: [
      { say: "duplicate the hero", does: "Second hero below the first" },
      { say: "copy the save button", does: "Another \"Save\" button" },
      { say: "add another card like get text reminders", does: "Copies that card" },
      { say: "duplicate the check status card called Upload documents", does: "Copy titled \"Upload documents\"" },
    ],
  },
  {
    id: "fields",
    title: "Form fields & headings",
    via: "direct",
    summary: "Required/optional, hints, placeholders, and heading levels.",
    examples: [
      { say: "make phone number required", does: "required: true" },
      { say: "make date of birth optional", does: "required: false" },
      { say: "add a hint to phone number that says Include your area code", does: "Hint text under the label" },
      { say: "change the full name hint to As it appears on your ID", does: "Replaces the hint" },
      { say: "set the placeholder for email address to name@example.gov", does: "Placeholder text" },
      { say: "remove the hint from date of birth", does: "Clears the hint" },
      { say: "make the heading an h2", does: "Heading level → H2" },
      { say: "change edit your profile to heading level three", does: "That heading → H3" },
    ],
  },
  {
    id: "lists",
    title: "Nav items, cards & lists",
    via: "direct",
    summary: "Add or remove single items inside navigation, the side nav, footer links, card groups, and lists.",
    examples: [
      { say: "let's go ahead and add a site header with the navigation home programs check status and sign in", does: "Header already on the page: its menu becomes Home · Programs · Check status · Sign in" },
      { say: "set the navigation to home apply and contact us", does: "Replaces the menu items" },
      { say: "add Help to the navigation", does: "New header nav item → /help" },
      { say: "remove Programs from the menu", does: "Removes that nav item" },
      { say: "add Settings to the side nav", does: "New side-nav link" },
      { say: "add Contact us to the footer", does: "New footer link" },
      { say: "add a card called Upload documents", does: "New card in the card group" },
      { say: "remove get text reminders from the cards", does: "Removes that card" },
      { say: "add Bring a photo ID to the list", does: "New list item" },
    ],
  },
  {
    id: "tables",
    title: "Tables",
    via: "direct",
    summary: "Rows, cells, columns, sorting, captions, and table styles. Refer to rows by a value in them (\"the SNAP row\"), by number (\"row 2\"), or as first/last.",
    examples: [
      { say: "add a row with WIC, pending, May 3", does: "New row, values in column order" },
      { say: "add a row for Housing with status pending and updated May 6", does: "First column Housing; named columns filled" },
      { say: "add a row with program TANF status approved updated May 7", does: "Named columns, no commas needed" },
      { say: "add an empty row at the top", does: "Blank first row" },
      { say: "add LIHEAP, pending, May 8 to the table", does: "New row" },
      { say: "remove the SNAP row", does: "Deletes the row containing SNAP" },
      { say: "delete row 2", does: "Deletes the second row" },
      { say: "remove the last row", does: "Deletes the last row" },
      { say: "move the WIC row to the top", does: "Reorders rows" },
      { say: "change the status of SNAP to denied", does: "Edits one cell" },
      { say: "set Medicaid status to approved", does: "Edits one cell" },
      { say: "change the updated for row 1 to June 1", does: "Edits a cell by row number" },
      { say: "change pending to in review", does: "Replaces every cell reading \"Pending\"" },
      { say: "add a column called Due date", does: "New column (empty cells)" },
      { say: "add a column called Case number after program", does: "New column in a specific spot" },
      { say: "rename the status column to Decision", does: "Column heading" },
      { say: "move the status column to the left", does: "Reorders columns and their cells" },
      { say: "remove the updated column", does: "Drops the column and its cells" },
      { say: "sort the table by program", does: "A → Z (numbers and dates sort as such)" },
      { say: "sort by updated newest first", does: "Descending" },
      { say: "set the table caption to Your applications", does: "Caption above the table" },
      { say: "make the table striped", does: "striped: true" },
      { say: "make the table borderless and compact", does: "borderless + compact" },
      { say: "remove the stripes from the table", does: "striped: false" },
      { say: "clear the table", does: "Removes every row (keeps columns)" },
    ],
    tips: [
      "Pause or say commas between values, or name the columns (\"status pending\") so values land in the right cells.",
    ],
  },
  {
    id: "remove",
    title: "Remove",
    via: "direct",
    summary: "Name what to remove — a section, or one element inside a form or group. Only that element is removed. If nothing on the page matches, Jev decides.",
    examples: [
      { say: "remove the cancel button", does: "Just the Cancel button, not its form" },
      { say: "great now let's go ahead and remove the cancel button", does: "Same, with filler words" },
      { say: "delete the phone number field", does: "Just that field" },
      { say: "remove the hero", does: "The hero section" },
      { say: "get rid of the check your status anytime card", does: "That one card" },
      { say: "remove the table", does: "The whole table" },
    ],
    tips: ["Removed the wrong thing? Say \"undo\"."],
  },
] as CommandGroup[]).map((g) => [g.id, g]));

export const COMMAND_GROUPS: CommandGroup[] = [
  ...componentGroups,
  CORE.text,
  ...contentGroups,
  CORE["button-style"],
  CORE.fields,
  CORE.tables,
  CORE.lists,
  CORE.move,
  CORE.duplicate,
  ...layoutGroups,
  CORE.remove,
  ...conversationGroups,
];
