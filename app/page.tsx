import Link from "next/link";

/** Landing: points at the voice planner and the generated pages. */
export default function Home() {
  return (
    <div className="grid-container margin-y-6">
      <h1>Voice-built USWDS sites</h1>
      <p className="usa-intro">
        Talk into the page planner. A speech-to-text transcript goes straight to Jev, Jev picks
        USWDS components from the uswds-json-render catalog, and the page builds itself in real time.
      </p>
      <Link href="/voice" className="usa-button usa-button--big">
        Open the voice planner
      </Link>
      <h2 className="margin-top-6">Generated pages</h2>
      <ul className="usa-list">
        <li><Link href="/marketing">Marketing page</Link></li>
        <li><Link href="/signin">Sign in</Link></li>
        <li><Link href="/dashboard">Dashboard</Link></li>
        <li><Link href="/profile">Profile</Link></li>
      </ul>
    </div>
  );
}
