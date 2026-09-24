/** Command groups: conversation — pronouns, corrections, multi-step, help/outline, undo/redo, pages, mic. Handled by lib/intents.ts, lib/session.ts + the API route. */
import type { CommandGroup } from "./command-types";
import type { PageSpec, SpecNode } from "./spec";
import { applyDirectEdit } from "./edits";
import { allNodes, nodeText } from "./edit-helpers";
import { isHelpRequest, isOutlineRequest, isStopListening, parseUndoCount, splitCommands } from "./intents";
import { correctedUtterance, outline, parseCorrection, recordFor } from "./session";

/** Test fixtures: find an element by its visible text. */
const byLabel = (page: PageSpec, label: string): SpecNode => {
  const hit = allNodes(page.nodes).find((n) => nodeText(n) === label.toLowerCase());
  if (!hit) throw new Error(`fixture has no "${label}"`);
  return hit;
};
const clone = (p: PageSpec): PageSpec => JSON.parse(JSON.stringify(p));

/** What each correction example corrects (the utterance said just before it). */
const CORRECTS: Record<string, string> = {
  "no I meant the cancel button": "make the save button big",
  "not that one, the save button": "remove the cancel button",
  "wrong one, the email field": "make phone number required",
  "no, the other button": "okay let's make the save button accent cool",
  "no no, not the heading, the hero": "move the heading to the bottom",
  "oops I meant make it outline": "make the save button big",
};

export const conversationGroups: CommandGroup[] = [
  {
    id: "pronouns",
    title: "It & that",
    via: "direct",
    summary: "\"It\", \"that\" and \"this one\" mean whatever you changed last, so you can keep going without naming it again.",
    examples: [
      { say: "okay now move it up", does: "After changing Phone number: moves that field up" },
      { say: "duplicate that", does: "Copies the field you just changed" },
      { say: "actually delete it", does: "Removes it" },
      { say: "rename it to mobile phone", does: "Field label → \"Mobile phone\"" },
      { say: "change its hint to include your area code", does: "Hint on the field you just changed" },
      { say: "give it a hint that says we only call about your case", does: "Same, adding a hint" },
      { say: "make it red", does: "After changing the Save button: variant secondary" },
      { say: "change it to say apply now", does: "Button label → \"Apply now\"" },
      { say: "make that say continue", does: "Button label → \"Continue\"" },
    ],
    tips: [
      "Works after any change — direct edits and Jev's alike. After removing something there's no \"it\" until the next change.",
      "\"Add a hint that says …\" with no field named goes on the field you just changed.",
    ],
    setup: (page) => { page.lastTouched = byLabel(page, "Phone number").id; },
    check: (say, page) => {
      const label = /\b(?:red|say)\b/i.test(say) ? "Save" : "Phone number";
      page.lastTouched = byLabel(page, label).id;
      const r = applyDirectEdit(say, page);
      const ok = !!r?.changed && r.note.includes(`"${label}"`);
      return { ok, detail: r ? r.note : "no direct edit matched" };
    },
  },
  {
    id: "corrections",
    title: "Corrections",
    via: "session",
    summary: "Changed the wrong thing? Say what you meant. The last change is undone and redone on the element you name.",
    examples: [
      { say: "no I meant the cancel button", does: "After \"make the save button big\": Save goes back, Cancel gets big" },
      { say: "not that one, the save button", does: "After \"remove the cancel button\": Cancel comes back, Save is removed" },
      { say: "wrong one, the email field", does: "After \"make phone number required\": Email address is required instead" },
      { say: "no, the other button", does: "After styling Save: the same style goes on Cancel" },
      { say: "no no, not the heading, the hero", does: "After \"move the heading to the bottom\": moves the hero instead" },
      { say: "oops I meant make it outline", does: "Undo, then run the new command on the same element" },
    ],
    tips: ["Corrections apply to the last change on the current page, and count as one undo step."],
    check: (say, page) => {
      const prior = CORRECTS[say];
      if (!prior) return { ok: false, detail: "add this example to CORRECTS" };
      const before = clone(page);
      const first = applyDirectEdit(prior, page);
      if (!first?.changed) return { ok: false, detail: `prior "${prior}" didn't apply` };
      const record = recordFor(prior, before, page);
      const correction = parseCorrection(say);
      if (!correction) return { ok: false, detail: "not recognized as a correction" };
      const undone = clone(before);
      undone.lastTouched = record.targetId;
      const retry = correctedUtterance(record, correction, undone);
      if (!retry || retry === prior) return { ok: false, detail: `no substitution (phrase: ${record.phrase ?? "none"})` };
      const r = applyDirectEdit(retry, undone);
      return { ok: !!r?.changed, detail: `"${prior}" → "${retry}": ${r ? r.note : "no direct edit matched"}` };
    },
  },
  {
    id: "multi",
    title: "Several commands at once",
    via: "session",
    summary: "Chain commands with \"and\", \"then\", or \"after that\". They run in order and count as one undo step.",
    examples: [
      { say: "make phone required and add a hint that says include your area code", does: "Required, then a hint on the same field" },
      { say: "add a heading that says Welcome, then add a paragraph", does: "Two new sections, in order (Jev picks each)" },
      { say: "okay let's make the save button red and then move it down", does: "Style, then reorder" },
      { say: "remove the hero, after that put the table below the heading", does: "Remove, then move" },
      { say: "rename the phone number field to mobile phone and make it required", does: "Rename, then required" },
    ],
    tips: [
      "\"And\" only splits when both halves start with a command word, so \"make the save and cancel buttons big and red\" is still one command.",
      "Say \"undo\" once to take back the whole utterance.",
    ],
    check: (say, page) => {
      const parts = splitCommands(say);
      const steps = parts.map((p) => {
        const r = applyDirectEdit(p, page);
        return `[${p}] ${r ? r.note : "→ Jev"}`;
      });
      return { ok: parts.length >= 2, detail: steps.join("  ") };
    },
  },
  {
    id: "outline-help",
    title: "Read back & help",
    via: "session",
    summary: "Hear what's on the page without changing anything, or open this command list.",
    examples: [
      { say: "what's on this page", does: "Reads back an outline: sections, fields, buttons" },
      { say: "okay read it back", does: "Same" },
      { say: "what do I have so far", does: "Same" },
      { say: "describe the page", does: "Same" },
      { say: "what can I say", does: "Opens this page in a new tab" },
      { say: "help", does: "Same" },
      { say: "show commands", does: "Same" },
    ],
    tips: ["Turn on 🔊 Voice feedback to hear the outline read aloud."],
    check: (say, page) => {
      const claimed = applyDirectEdit(say, clone(page));
      if (claimed) return { ok: false, detail: `claimed by direct edit: ${claimed.note}` };
      if (isHelpRequest(say)) return { ok: true, detail: "opens /commands" };
      if (isOutlineRequest(say)) return { ok: true, detail: outline(page) };
      return { ok: false, detail: "not recognized" };
    },
  },
  {
    id: "pages",
    title: "Pages",
    via: "routing",
    summary: "Switch to an existing page or start a new one. New pages are named from what you say.",
    examples: [
      { say: "okay let's go to the marketing page", does: "Switches to /marketing" },
      { say: "take me to the sign in page", does: "Switches to /signin" },
      { say: "start a new status tracker page", does: "Creates /status-tracker" },
      { say: "go back to the profile page", does: "Switches to /profile" },
    ],
    tips: ["Include the word \"page\" (or \"route\" / \"screen\") so it's treated as navigation."],
  },
  {
    id: "history",
    title: "Undo & redo",
    via: "routing",
    summary: "Step back or forward through changes on the current page (also ⌘Z / ⇧⌘Z and the buttons). Say how many steps, or \"everything\".",
    examples: [
      { say: "undo", does: "Reverts the last change" },
      { say: "okay undo that", does: "Same" },
      { say: "take that back", does: "Same" },
      { say: "redo", does: "Re-applies the undone change" },
      { say: "put it back", does: "Same" },
      { say: "undo the last three changes", does: "Three steps back" },
      { say: "undo that twice", does: "Two steps back" },
      { say: "redo two times", does: "Two steps forward" },
      { say: "undo everything", does: "All the way back; the note says how many steps" },
    ],
    check: (say, page) => {
      const h = parseUndoCount(say);
      const claimed = applyDirectEdit(say, page);
      if (claimed) return { ok: false, detail: `claimed by direct edit: ${claimed.note}` };
      return { ok: !!h, detail: h ? `${h.direction} ×${h.count}` : "not a history command" };
    },
  },
  {
    id: "mic",
    title: "Mic & voice feedback",
    via: "session",
    summary: "Turn the mic off by voice. Nothing is sent to the planner. Use the 🔊 Voice feedback toggle to hear each result read aloud.",
    examples: [
      { say: "stop listening", does: "Turns the mic off" },
      { say: "okay pause", does: "Same" },
      { say: "that's all for now", does: "Same" },
      { say: "stop the mic", does: "Same" },
      { say: "I'm done for now thanks", does: "Same" },
    ],
    tips: [
      "Voice feedback is off by default and remembered in this browser. The mic pauses while it speaks so it doesn't hear itself.",
    ],
    check: (say) => ({ ok: isStopListening(say), detail: isStopListening(say) ? "mic off (client-side)" : "not recognized" }),
  },
];
