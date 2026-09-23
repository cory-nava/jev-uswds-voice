/** Runs the demo script through the live /api/jev pipeline, simulating the
 *  voice console: one tracked current page, updated from each response. */
const steps = [
  "Start a new marketing page for Benefit Tracker, a fictional federal benefits service",
  "Add the official government banner at the top",
  "Add a site header with navigation: Home, Programs, Check status, and Sign in",
  'Add a hero with the heading "Track your benefits in one place" and the text "One secure account for SNAP, Medicaid, housing help, and more."',
  'Add three feature cards: "Apply in one place", "Check your status anytime", "Get text reminders"',
  "Add a medium footer for Benefit Tracker",
  "Start the sign in page",
  'Add a heading "Sign in to your account"',
  "Add an email input and a password input",
  "Add a primary sign in button",
  "Start the dashboard page",
  'Add a heading "Your applications"',
  "Add a table of benefit applications with columns: Program, Status, Updated",
  "Add a side navigation with links: Overview, Applications, Documents, Profile",
  "Start the profile page",
  'Add a heading "Edit your profile"',
  "Add a form to edit your profile with fields for full name, date of birth, and phone number",
  "Add save and cancel buttons",
];

await fetch("http://localhost:3100/api/pages", { method: "DELETE" });

let currentPageId = "marketing";
let failures = 0;
for (const [i, utterance] of steps.entries()) {
  const t0 = Date.now();
  const res = await fetch("http://localhost:3100/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance, pageId: currentPageId }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  if (data.pageId) currentPageId = data.pageId;
  const dec = (data.decisions || []).map((d) => `${d.question}=${d.choice}`).join(" ");
  const status = res.ok ? (data.changed ? "CHANGED" : "note") : "ERROR";
  if (!res.ok) failures++;
  console.log(`[${i + 1}/${steps.length}] ${ms}ms ${status} page=${data.pageId || currentPageId}`);
  console.log(`   "${utterance.slice(0, 90)}"`);
  console.log(`   jev: ${dec}`);
  console.log(`   -> ${res.ok ? data.note : data.error}`);
}
console.log(failures === 0 ? "\nALL STEPS OK" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
