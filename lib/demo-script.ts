/**
 * Scripted demo utterances. Each goes through the exact same path as live
 * speech (utterance → direct edit or one Jev call → JSON patch → render), and
 * they're written the way people talk: no quotes or colons. "Play demo
 * script" in the voice planner feeds these in order, starting from blank
 * pages; `pnpm demo` replays them against a running server.
 *
 * The result should come close to the sample pages in lib/templates/ (which
 * Reset restores): banner, header, and footer on every page; a hero, top
 * tasks, programs, and help on the marketing page; a sign-in page with
 * account and help sections; a dashboard and profile with a side nav.
 */
export interface DemoStep {
  pageId: string;
  utterance: string;
}

const chrome = (pageId: string): DemoStep[] => [
  { pageId, utterance: "add the official government banner at the top" },
  { pageId, utterance: "add a site header with the navigation programs check status get help and sign in" },
];

const footer = (pageId: string): DemoStep[] => [
  { pageId, utterance: "add a medium footer for Benefit Tracker" },
];

const accountNav = (pageId: string): DemoStep => ({
  pageId,
  utterance: "add a side navigation with links overview applications documents messages and profile",
});

export const DEMO_SCRIPT: DemoStep[] = [
  // ---- Marketing page ----
  { pageId: "marketing", utterance: "start a new marketing page for Benefit Tracker, a fictional federal benefits service" },
  ...chrome("marketing"),
  { pageId: "marketing", utterance: "add a hero with the heading track your benefits in one place and the text one secure account for food assistance, health coverage, housing help, and more" },
  { pageId: "marketing", utterance: "add a heading that says top tasks" },
  { pageId: "marketing", utterance: "add three feature cards apply for benefits, check your status, and get text reminders" },
  { pageId: "marketing", utterance: "add a description to the apply for benefits card that says answer a few questions once and apply to several programs at the same time" },
  { pageId: "marketing", utterance: "add a description to the check your status card that says see where each application stands and what you need to do next" },
  { pageId: "marketing", utterance: "add a description to the get text reminders card that says get a text when a deadline is coming up or a decision is made" },
  { pageId: "marketing", utterance: "add a heading that says explore programs" },
  { pageId: "marketing", utterance: "add a collection for food assistance health coverage housing help child care energy bills and job training" },
  { pageId: "marketing", utterance: "add a summary box with the heading need help and items call the help desk, chat with us online after you sign in, and visit a local office" },
  ...footer("marketing"),
  { pageId: "marketing", utterance: "add accessibility to the footer" },
  { pageId: "marketing", utterance: "add privacy to the footer" },

  // ---- Sign-in page ----
  { pageId: "signin", utterance: "start the sign in page" },
  ...chrome("signin"),
  { pageId: "signin", utterance: "add a heading that says sign in" },
  { pageId: "signin", utterance: "add a lead paragraph that says sign in to check your applications, upload documents, and update your contact information" },
  { pageId: "signin", utterance: "add a form with fields for email address and password" },
  { pageId: "signin", utterance: "add a checkbox that says keep me signed in on this device" },
  { pageId: "signin", utterance: "move it into the form" },
  { pageId: "signin", utterance: "add a primary sign in button" },
  { pageId: "signin", utterance: "move it into the form" },
  { pageId: "signin", utterance: "add a link called forgot your password" },
  { pageId: "signin", utterance: "add a divider" },
  { pageId: "signin", utterance: "add a heading that says don't have an account" },
  { pageId: "signin", utterance: "add a paragraph that says create an account to apply for benefits and track every application in one place" },
  { pageId: "signin", utterance: "add a button that says create an account" },
  { pageId: "signin", utterance: "make it outline" },
  { pageId: "signin", utterance: "add a heading that says having trouble signing in" },
  { pageId: "signin", utterance: "add a paragraph that says call the help desk at 555 010 0199, monday to friday, 8 a.m. to 6 p.m." },
  ...footer("signin"),

  // ---- Dashboard page ----
  { pageId: "dashboard", utterance: "start the dashboard page" },
  ...chrome("dashboard"),
  accountNav("dashboard"),
  { pageId: "dashboard", utterance: "add a heading that says your applications" },
  { pageId: "dashboard", utterance: "add a lead paragraph that says welcome back, here's where each of your applications stands" },
  { pageId: "dashboard", utterance: "add a warning alert with the heading action needed and the message upload proof of income for your food assistance application by may 30" },
  { pageId: "dashboard", utterance: "add a table of applications with columns program status and last updated" },
  { pageId: "dashboard", utterance: "add a row with program food assistance status documents needed last updated may 12" },
  { pageId: "dashboard", utterance: "add a row with program health coverage status in review last updated may 8" },
  { pageId: "dashboard", utterance: "add a row with program housing help status approved last updated april 22" },
  { pageId: "dashboard", utterance: "make the table striped" },
  { pageId: "dashboard", utterance: "set the table caption to applications" },
  { pageId: "dashboard", utterance: "add a heading that says health coverage application" },
  { pageId: "dashboard", utterance: "add a step indicator with steps submitted in review and decision, currently on in review" },
  { pageId: "dashboard", utterance: "add a heading that says quick actions" },
  { pageId: "dashboard", utterance: "add a button group with upload a document and start a new application" },
  ...footer("dashboard"),

  // ---- Profile page ----
  { pageId: "profile", utterance: "start the profile page" },
  ...chrome("profile"),
  accountNav("profile"),
  { pageId: "profile", utterance: "add a heading that says edit your profile" },
  { pageId: "profile", utterance: "add a lead paragraph that says we use this information to contact you about your applications" },
  { pageId: "profile", utterance: "add a form with fields for full name date of birth phone number and email address" },
  { pageId: "profile", utterance: "add a hint to full name that says as it appears on your id" },
  { pageId: "profile", utterance: "add a hint to phone number that says include your area code" },
  { pageId: "profile", utterance: "add radio buttons for how should we contact you with options email phone call and text message" },
  { pageId: "profile", utterance: "move it into the form" },
  { pageId: "profile", utterance: "add a checkbox that says send me text reminders about deadlines" },
  { pageId: "profile", utterance: "move it into the form" },
  { pageId: "profile", utterance: "add a button group with save and cancel" },
  { pageId: "profile", utterance: "move it into the form" },
  ...footer("profile"),
];
