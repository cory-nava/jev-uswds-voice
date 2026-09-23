/**
 * Scripted demo utterances. Each goes through the exact same path as live
 * speech: utterance -> Jev (one call) -> JSON patch -> render.
 * "Play demo script" in the voice planner feeds these in order.
 */
export interface DemoStep {
  pageId: string;
  utterance: string;
}

export const DEMO_SCRIPT: DemoStep[] = [
  // ---- Marketing page ----
  { pageId: "marketing", utterance: "Start a new marketing page for Benefit Tracker, a fictional federal benefits service" },
  { pageId: "marketing", utterance: "Add the official government banner at the top" },
  { pageId: "marketing", utterance: "Add a site header with navigation: Home, Programs, Check status, and Sign in" },
  { pageId: "marketing", utterance: 'Add a hero with the heading "Track your benefits in one place" and the text "One secure account for SNAP, Medicaid, housing help, and more."' },
  { pageId: "marketing", utterance: 'Add three feature cards: "Apply in one place", "Check your status anytime", "Get text reminders"' },
  { pageId: "marketing", utterance: "Add a medium footer for Benefit Tracker" },
  // ---- Sign-in page ----
  { pageId: "signin", utterance: "Start the sign in page" },
  { pageId: "signin", utterance: 'Add a heading "Sign in to your account"' },
  { pageId: "signin", utterance: "Add an email input and a password input" },
  { pageId: "signin", utterance: "Add a primary sign in button" },
  // ---- Dashboard page ----
  { pageId: "dashboard", utterance: "Start the dashboard page" },
  { pageId: "dashboard", utterance: 'Add a heading "Your applications"' },
  { pageId: "dashboard", utterance: "Add a table of benefit applications with columns: Program, Status, Updated" },
  { pageId: "dashboard", utterance: "Add a side navigation with links: Overview, Applications, Documents, Profile" },
  // ---- Profile page (CRUD) ----
  { pageId: "profile", utterance: "Start the profile page" },
  { pageId: "profile", utterance: 'Add a heading "Edit your profile"' },
  { pageId: "profile", utterance: "Add a form to edit your profile with fields for full name, date of birth, and phone number" },
  { pageId: "profile", utterance: "Add save and cancel buttons" },
];
