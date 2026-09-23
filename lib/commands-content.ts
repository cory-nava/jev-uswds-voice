/**
 * Command groups: content edits — select/radio/checkbox/combo-box options,
 * link hrefs, alert type/heading/message/style, field type conversions, card
 * details, and header/footer settings. Handled by lib/edits-content.ts.
 *
 * The shared fixture (scripts/check-commands.ts) doesn't have option fields,
 * alerts, or extra links, so each group's `setup` adds what its examples need.
 */
import type { CommandGroup } from "./command-types";
import type { SpecNode } from "./spec";
import { newId } from "./spec";

export const contentGroups: CommandGroup[] = [
  {
    id: "options",
    title: "Options",
    via: "direct",
    summary: "Add, remove, or replace the options on a Select, Radio group, CheckboxGroup, or ComboBox.",
    examples: [
      { say: "add texas to the state dropdown", does: "Adds \"Texas\" to the state Select" },
      { say: "remove alaska from the state dropdown", does: "Removes \"Alaska\" from the state Select" },
      { say: "give it the options yes, no, not sure", does: "Replaces the last-touched field's options" },
      { say: "set the options for contact method to email, phone, text", does: "Replaces the Contact method Radio options" },
      { say: "add reading to the interests checkbox group", does: "Adds \"Reading\" to the Interests CheckboxGroup" },
      { say: "remove newsletter from the interests checkboxes", does: "Removes \"Newsletter\" from the Interests CheckboxGroup" },
    ],
    tips: ["Name the field by its label (\"the state dropdown\", \"contact method\") or say \"it\" for the field you just touched."],
    setup(page) {
      const select: SpecNode = {
        id: newId(page), type: "Select",
        props: { label: "State", name: "state", options: ["Alabama", "Alaska", "Arizona"], placeholder: null, hint: null, value: null, required: null, checks: null, validateOn: null },
      };
      const radio: SpecNode = {
        id: newId(page), type: "Radio",
        props: { legend: "Contact method", name: "contactmethod", options: [{ label: "Mail", value: "mail", hint: null }], tile: null, value: null, checks: null, validateOn: null },
      };
      const checkboxes: SpecNode = {
        id: newId(page), type: "CheckboxGroup",
        props: { legend: "Interests", name: "interests", options: [{ label: "Newsletter", value: "newsletter", hint: null }], tile: null, values: null },
      };
      page.nodes.push(select, radio, checkboxes);
      page.lastTouched = radio.id;
    },
  },
  {
    id: "links",
    title: "Links",
    via: "direct",
    summary: "Set where a button, link, or nav item goes. Spoken URLs: \"slash apply\" → \"/apply\", \"benefits dot gov\" → \"benefits.gov\"; https URLs are kept as typed.",
    examples: [
      { say: "link the apply button to slash apply", does: "Button href → \"/apply\"" },
      { say: "make help go to slash support", does: "Header nav item \"Help\" href → \"/support\"" },
      { say: "link the read more link to benefits dot gov", does: "Link href → \"benefits.gov\"" },
      { say: "link the apply button to https://benefits.gov/apply", does: "Kept exactly as typed" },
      { say: "make contact us go to slash contact us", does: "Footer link \"Contact us\" href → \"/contact-us\"" },
    ],
    tips: ["Buttons render as a link (`<a class=\"usa-button\">`) once they have an href, so they still look like buttons."],
    setup(page) {
      const button: SpecNode = { id: newId(page), type: "Button", props: { label: "Apply", variant: "default", disabled: false, type: "button" } };
      const link: SpecNode = { id: newId(page), type: "Link", props: { label: "Read more", href: "/learn-more", external: false, variant: "default" } };
      page.nodes.push(button, link);
      const header = page.nodes.find((n) => n.type === "Header");
      if (header) {
        header.props.navItems = [...((header.props.navItems as unknown[]) ?? []), { label: "Help", href: "/help", current: false, items: null }];
      }
      const footer = page.nodes.find((n) => n.type === "Footer");
      const groups = footer?.props.navGroups as Array<{ heading: string | null; links: Array<{ label: string; href: string }> }> | undefined;
      groups?.[0]?.links.push({ label: "Contact us", href: "/contact" });
    },
  },
  {
    id: "alerts",
    title: "Alerts",
    via: "direct",
    summary: "Change an Alert or SiteAlert's type, heading, message, slim style, or icon.",
    examples: [
      { say: "make the alert a warning", does: "type: warning" },
      { say: "make the alert an error", does: "type: error" },
      { say: "change the alert heading to application submitted", does: "New heading text" },
      { say: "change the alert message to we will contact you within five business days", does: "New message text" },
      { say: "make the alert slim", does: "slim: true" },
      { say: "remove the alert icon", does: "noIcon: true" },
    ],
    tips: ["\"the alert\" means the page Alert; say \"the site alert\" for the SiteAlert banner (info or emergency only)."],
    setup(page) {
      const alert: SpecNode = {
        id: newId(page), type: "Alert",
        props: { heading: "Application received", message: "We'll email you when there's an update.", type: "info", slim: false, noIcon: false },
      };
      const siteAlert: SpecNode = {
        id: newId(page), type: "SiteAlert",
        props: { heading: "Demonstration site", message: "This is a fictional demonstration service.", type: "info", slim: false },
      };
      page.nodes.push(alert, siteAlert);
    },
  },
  {
    id: "field-types",
    title: "Field types",
    via: "direct",
    summary: "Convert a field between kinds — email/phone/url input, text area, dropdown, password, or a character-limited field — and adjust rows.",
    examples: [
      { say: "make contact email an email field", does: "Input type → email" },
      { say: "make phone a phone number field", does: "Converts the Input to an InputMask (preset: phone)" },
      { say: "make message a text area", does: "Converts the Input to a Textarea" },
      { say: "make state a dropdown", does: "Converts the Input to a Select" },
      { say: "make it a password field", does: "Converts the last-touched field to a Password" },
      { say: "make the feedback box taller", does: "Textarea rows: 4 → 8" },
      { say: "give the feedback field 8 rows", does: "Textarea rows → 8" },
      { say: "limit the feedback field to 200 characters", does: "Converts the Textarea to a CharacterCount (maxLength: 200)" },
    ],
    tips: ["Converting keeps the field's label, name, hint, and required setting."],
    setup(page) {
      const contactEmail: SpecNode = { id: newId(page), type: "Input", props: { label: "Contact email", name: "contactemail", type: "text", placeholder: null, hint: null } };
      const message: SpecNode = { id: newId(page), type: "Input", props: { label: "Message", name: "message", type: "text", placeholder: null, hint: null } };
      const state: SpecNode = { id: newId(page), type: "Input", props: { label: "State", name: "state", type: "text", placeholder: null, hint: null } };
      const accessCode: SpecNode = { id: newId(page), type: "Input", props: { label: "Access code", name: "accesscode", type: "text", placeholder: null, hint: null } };
      const feedback: SpecNode = { id: newId(page), type: "Textarea", props: { label: "Feedback", name: "feedback", placeholder: null, hint: null, rows: 4 } };
      page.nodes.push(contactEmail, message, state, accessCode, feedback);
      page.lastTouched = accessCode.id;
    },
  },
  {
    id: "cards",
    title: "Cards",
    via: "direct",
    summary: "Add a description or image to a card, change its title, switch the card group to flag style, or put the heading first.",
    examples: [
      { say: "add a description to the apply card that says takes about ten minutes", does: "Card description text" },
      { say: "change the check status card title to review your status", does: "Card title" },
      { say: "add an image to the apply card", does: "mediaUrl → the spoken URL, or a placeholder image" },
      { say: "make the cards flag style", does: "Every card: flag: true" },
      { say: "put the card heading first", does: "Every card: headerFirst: true" },
    ],
    tips: ["No URL spoken for an image? A placeholder image is used."],
  },
  {
    id: "header-footer",
    title: "Header & footer",
    via: "direct",
    summary: "Site name, agency name, header search box and extended layout, footer size, and the back-to-top link.",
    examples: [
      { say: "change the site name to neighborhood services", does: "Header siteName" },
      { say: "change the agency name to department of neighborhood services", does: "Footer agencyName" },
      { say: "add a search box to the header", does: "showSearch: true" },
      { say: "remove the search from the header", does: "showSearch: false" },
      { say: "make the header extended", does: "variant: extended" },
      { say: "make the footer big", does: "variant: big" },
      { say: "add a back to top link", does: "returnToTop: true" },
      { say: "turn off return to top", does: "returnToTop: false" },
    ],
  },
];
