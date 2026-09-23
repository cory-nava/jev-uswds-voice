/** Command groups: grouping/layout (lib/edits-layout.ts) and page management (lib/page-commands.ts). */
import type { CommandGroup } from "./command-types";
import { applyDirectEdit } from "./edits";
import { parsePageCommand } from "./page-commands";

export const layoutGroups: CommandGroup[] = [
  {
    id: "group-arrange",
    title: "Group & arrange",
    via: "direct",
    summary: "Wrap named elements in a button group, section, or grid; move things into or out of a container; ungroup a container.",
    setup: (page) => {
      page.nodes.push(
        { id: "extra-print", type: "Button", props: { label: "Print", variant: "outline" } },
        { id: "extra-email", type: "Button", props: { label: "Email", variant: "outline" } },
      );
    },
    examples: [
      { say: "put the print and email buttons in a button group", does: "New ButtonGroup wrapping both buttons" },
      { say: "wrap the heading and the form in a section", does: "New Section containing the heading and the form" },
      { say: "put the cards in three columns", does: "The card group becomes a 3-column grid" },
      { say: "make the cards a three column grid", does: "Same, worded as a grid" },
      { say: "put the phone number and email fields side by side", does: "New 2-column grid holding both fields" },
      { say: "move the save and cancel buttons into the form", does: "Buttons become direct children of the form" },
      { say: "take the cancel button out of the form", does: "Cancel button placed right after the form" },
      { say: "ungroup the buttons", does: "Button group removed; Save and Cancel become direct siblings" },
    ],
    tips: ["Name every element (\"the save and cancel buttons\") — the first one named decides where the new group goes."],
  },
  {
    id: "manage-pages",
    title: "Manage pages",
    via: "routing",
    summary: "Rename, delete, restore, duplicate, retitle, clear, or list pages. Resolved instantly, like navigation and undo — no Jev call.",
    examples: [
      { say: "rename this page to status", does: "Moves the spec + undo history to specs/status.json" },
      { say: "rename the test page to status", does: "Same, naming the page to rename" },
      { say: "delete this page", does: "Soft-deletes it to specs/.trash/" },
      { say: "delete the test page", does: "Soft-deletes the named page" },
      { say: "restore the test page", does: "Brings a deleted page back from the trash" },
      { say: "duplicate the sign in page as sign up", does: "New \"sign-up\" page with a copy of the nodes" },
      { say: "set the page title to Check your status", does: "Updates PageSpec.title" },
      { say: "start over", does: "Clears this page's nodes (\"undo\" brings them back)" },
      { say: "what pages do I have", does: "Lists the pages — nothing changes" },
    ],
    check: (say, page) => {
      const parsed = parsePageCommand(say);
      const direct = applyDirectEdit(say, page);
      const ok = parsed !== null && !direct;
      return {
        ok,
        detail: !parsed
          ? "not recognized as a page command"
          : direct
            ? `claimed by direct edit: ${direct.note}`
            : `parsed intent: ${parsed.kind}`,
      };
    },
  },
];
