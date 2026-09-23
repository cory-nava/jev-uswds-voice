# jev-uswds-voice

A voice-driven website builder for USWDS (U.S. Web Design System) pages,
powered by [Jev](https://typesafe.ai) — TypeSafe's System One decision model.

Talk into the page planner and it builds the site in real time — pages,
forms, tables, navigation — all from spoken instructions.

This is a sample / demonstration project. The fictional benefits service it
builds is clearly labeled as fictional.

## How it works

The pipeline follows Jonathan Moore's "designing at the speed of voice"
pattern (Jev + shadcn, Sep 2026), adapted to USWDS:

1. **Capture** — the browser's SpeechRecognition API (which on Apple devices
   runs on the device's own speech stack) transcribes the microphone, or a
   scripted demo utterance is played, or text is typed into the instruction box.
2. **Decide** — the transcript goes straight to Jev as state, together with the
   current page spec and the USWDS component catalog. One Jev call answers six
   evaluation questions: is this a UI instruction? which page? create, replace,
   modify, style, or remove? which existing section? where? which component?
   (~200–1200ms round trip).
3. **Apply** — Jev's answers become a JSON patch against the page spec.
   Content comes from the transcript (quoted strings, field lists); structure
   comes from Jev's component choice. Jev never writes markup — it only
   selects from the 62 known USWDS components in `@cdt5058/json-render-uswds`.
   Voice works because the choices are already structured.
4. **Render** — the spec is converted to the flat element-map format
   (`{ root, elements }`) that `@json-render/react` expects and rendered as
   live USWDS markup inside `JSONUIProvider`.

## Quick start

```bash
npm install

# 1. Jev API key (TypeSafe). Get one at https://typesafe.ai
export TYPESAFE_API_KEY=...

# 2. Run (production mode — the sandbox-tested path)
npm run build
PORT=3100 npm start
```

Open http://localhost:3100/voice — the voice planner. Click **Talk to build**
(or **Play demo script** for the scripted 18-utterance walkthrough), then open
the generated pages (`/marketing`, `/signin`, `/dashboard`, `/profile`).

> The demo utterances live in `lib/demo-script.ts`; `scripts/run-demo.mjs`
> replays them through the live API for regression testing (18/18 expected).

## Project layout

```
app/voice/page.tsx        voice planner: mic loop, transcript + Jev decision log,
                          page tabs, live canvas, demo player
app/api/jev/route.ts      utterance -> nav interception -> Jev bridge -> JSON patch
app/[pageId]/page.tsx     dynamic route rendering any spec by id
app/{marketing,signin,dashboard,profile}/  generated pages (spec-driven;
                          signin/dashboard/profile wrap specs with mock auth)
lib/jev.ts                Moore's flow: question builder, component shortlist,
                          deterministic content extraction, patch application
lib/jev_bridge.py         stdin->Jev->stdout bridge (surrogate or TYPESAFE_API_KEY)
lib/spec.ts               id-tagged spec nodes; toRenderSpec -> flat element map
lib/catalog.ts            component registry (62 USWDS definitions)
lib/registry.tsx          SpecCanvas: JSONUIProvider + Renderer
lib/store.ts              specs/*.json persistence
lib/auth.tsx              AuthProvider interface: mock now, login.gov / id.me later
lib/demo-script.ts        18 scripted utterances (the demo walkthrough)
specs/                    built page specs (marketing, signin, dashboard, profile)
```

## Speech-to-text

The live microphone path uses the browser's built-in SpeechRecognition API. On
Apple devices this runs against the device's local speech models — no audio
leaves the machine for transcription. (Chrome exposes it as the Web Speech
API; Safari as `webkitSpeechRecognition`.) The transcript — never audio — is
what gets sent to Jev.

For demos without a microphone, use **Play demo script** or type into the
instruction box at the bottom of the planner.

## Authentication

`lib/auth.tsx` defines an `AuthProvider` interface
(`signIn` / `signOut` / `getUser`). The app ships with `MockAuthProvider`
(dev mode, localStorage-backed, selected via `NEXT_PUBLIC_AUTH_PROVIDER=mock`).
`LoginGovProvider` and `IdMeProvider` are stubbed with wiring notes where the
OIDC/OAuth2 exchange would go — add a real provider by implementing the
interface and switching the env var. The sign-in page itself is voice-built;
the provider only handles the credential exchange behind it.

## Configuration

| Env var | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Jev API key (or use the `custom.typesafe` connector via authd) |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `mock` (default), `logingov`, `idme` |

Nothing in this project deploys anywhere on its own — it runs on localhost.

## Honesty guardrails

- Pages built from voice for the fictional service get a SiteAlert:
  *"Demonstration site — this is a fictional service built by voice."*
- Jev decides structure only. Literal copy always comes from the transcript,
  so the model can't hallucinate content into a page.

## Tech notes

- Next.js 15 + React 19, `@json-render/react` + `@cdt5058/json-render-uswds`
  (Cory's Apache-2.0 catalog).
- The Renderer requires the flat `{ root, elements }` spec shape and must sit
  inside `JSONUIProvider` (state/visibility/action providers).
- `next dev` doesn't hydrate in some sandboxed environments; verify with
  `next build && next start`.
