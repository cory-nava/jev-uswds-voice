import type { Metadata } from "next";
import Link from "next/link";
import { COMMAND_GROUPS, VIA_LABELS, type CommandVia } from "@/lib/commands";

export const metadata: Metadata = {
  title: "Voice commands — Voice-built USWDS sites",
  description: "Everything you can say to the voice planner, with examples.",
};

const VIA_TAG: Record<CommandVia, string> = {
  session: "bg-orange",
  direct: "bg-green",
  routing: "bg-primary",
  text: "bg-accent-cool-darker",
  jev: "bg-violet-warm-60",
};

/** Voice command reference, generated from lib/commands.ts. */
export default function CommandsPage() {
  return (
    <div className="grid-container margin-y-6">
      <div className="grid-row grid-gap-lg">
        <nav className="tablet:grid-col-3 margin-bottom-4" aria-label="Command groups">
          <ul className="usa-sidenav">
            {COMMAND_GROUPS.map((g) => (
              <li key={g.id} className="usa-sidenav__item">
                <a href={`#${g.id}`}>{g.title}</a>
              </li>
            ))}
          </ul>
          <p className="margin-top-3">
            <Link href="/voice" className="usa-button">Open the voice planner</Link>
          </p>
        </nav>

        <main className="tablet:grid-col-9">
          <h1 className="margin-top-0">Voice commands</h1>
          <p className="usa-intro">
            Say these to the voice planner, or type them in its text box. Filler like “okay”, “so”,
            “can we”, and “let’s” is fine, and you can phrase things your own way. The examples show
            the patterns that work.
          </p>
          <ul className="usa-list">
            {(Object.keys(VIA_LABELS) as CommandVia[]).map((via) => (
              <li key={via}>
                <span className={`usa-tag ${VIA_TAG[via]}`}>{VIA_LABELS[via]}</span>{" "}
                {via === "direct" && "matched against what’s already on the page; no Jev call."}
                {via === "routing" && "switches pages or steps through history; no Jev call."}
                {via === "text" && "Jev finds the element; the new words come straight from what you said."}
                {via === "jev" && "Jev chooses the USWDS component and where it goes."}
                {via === "session" && "works on the conversation itself — “it”, corrections, several commands at once; no Jev call."}
              </li>
            ))}
          </ul>

          {COMMAND_GROUPS.map((g) => (
            <section key={g.id} id={g.id} className="margin-top-6">
              <h2 className="margin-bottom-1">
                {g.title} <span className={`usa-tag ${VIA_TAG[g.via]} text-middle`}>{VIA_LABELS[g.via]}</span>
              </h2>
              <p className="margin-top-1">{g.summary}</p>
              <table className="usa-table usa-table--borderless width-full">
                <thead>
                  <tr>
                    <th scope="col">Say</th>
                    <th scope="col">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {g.examples.map((ex) => (
                    <tr key={ex.say}>
                      <td>“{ex.say}”</td>
                      <td>{ex.does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.tips?.map((tip) => (
                <p key={tip} className="text-base-dark font-sans-xs">Tip: {tip}</p>
              ))}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
