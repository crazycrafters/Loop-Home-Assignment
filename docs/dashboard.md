# Repository dashboard

The dashboard is served at `/` by the same Fastify service as the API. Run `npm ci`
and `npm run dev`, then open the local service in your browser. Production uses
`npm run build` followed by `npm start`. No frontend server, CDN, or separate
runtime dependency is required.

## Walkthrough

1. Enter a public repository as `owner/repository` and select UTC dates. The end
   date is exclusive; the range can span up to 90 days. **Try an example** presets
   `sindresorhus/p-limit`, August 1–September 1, 2026. It does not fetch data until
   you click **Analyze repository**.
2. Inspect merged PRs, merge time, first-review timing, and review coverage. Each
   card shows the previous period, change, sample size, and source-PR action.
   The reporting header identifies both exact periods and source fetched time.
   Bars compare the two values within each card; bars across different cards do
   not share a unit or scale. All scalar metrics and definitions are expandable.
3. Review quality notes, current open/draft backlog, and the top five contributor
   and reviewer rows. Current backlog is labeled as a current snapshot, not
   historical state. Automation is included and activity is not productivity.
4. Click a source action to filter PR evidence. Expand a PR for lifecycle and review
   records; links open GitHub safely in a new tab. The UI shows up to five qualifying
   reviews per PR to keep large snapshots usable; the API retains the complete
   bounded evidence, and GitHub links expose the full PR history.
5. Optionally click **Generate explanation**. This is the only action that requests
   an LLM narrative. Read the hypothesis, uncalibrated confidence, limitations, and
   fact chips; each chip filters the source PRs for that fact. Abstention is shown
   explicitly. Credentials are configured on the server, never entered in the UI.

Narratives still require `LLM_API_KEY` and provider access. If unavailable, the
interface explains this and preserves metrics/evidence. No canned narrative is
shown. See [narrative configuration and validation](narratives.md).

## State, safety, and accessibility

Changing a selection hides the old report, aborts browser requests, and invalidates
late responses. A narrative from a different source timestamp or period is withheld
until the user analyzes again, preventing a newer explanation from appearing next
to older numbers. Browser cancellation does not guarantee that a server/provider
operation already in progress was canceled.

Invalid input, upstream rate limits, oversized collections, network failures, and
provider unavailability have visible feedback. Empty timing values remain missing,
not zero; empty cohorts have an explanatory notice. No data or AI call is made
simply by visiting the page.

All dynamic account/model/source text uses DOM text nodes, not HTML injection.
External evidence links are restricted to HTTPS GitHub PR/review paths. Explicit
asset routes expose no arbitrary files. A Content Security Policy permits only
same-origin scripts/styles/API requests; no inline scripts, external fonts, or
remote UI assets are required. The page uses labeled controls, live status/error
regions, a skip link, visible keyboard focus, native expandable sections, reduced
motion support, and layouts checked at desktop and 390-pixel mobile widths.
Keyboard/mobile smoke coverage is not a claim of a full accessibility audit.

## Development and tests

Browser TypeScript lives in `src/dashboard/client.ts`. Its server imports are
**type-only** and disappear from emitted JavaScript. Static HTML/CSS live beside it;
`tsc` and `scripts/copy-dashboard.mjs` prepare `dist/dashboard/`. `npm run dev` builds
first and watches backend modules. After editing dashboard assets/client code,
run `npm run build` and refresh; frontend hot reload is not configured.

```sh
npm run typecheck
npm test                 # Builds first, then runs service tests
npm run build
npm run test:browser     # Requires built assets and Chromium
npm run check            # Type check, build/service tests, browser tests
```

Playwright automatically uses `/usr/bin/chromium` when present. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another existing executable. Otherwise,
install its managed browser with `npx playwright install --with-deps chromium`.
That installation needs the usual browser-download and OS-package access; it is
not needed merely to run the service. CI pins Ubuntu 24.04, reports its preinstalled Chromium/Chrome version, and reuses
that browser. It installs Playwright Chromium only if neither system browser exists.
Browser tests start an isolated production server on port 3177 and use API/provider
fixtures without network credentials or paid requests. Failure screenshots/traces
are written under ignored `test-results/`.

Validation covers rendering, evidence filtering, explicit narrative generation,
confidence/citations, provider-unavailable behavior, date validation/rate limits,
stale responses, refreshed-source mismatch, literal untrusted text, unsafe links,
keyboard/mobile layout, and unexpected success payloads. A separate live Chromium
check fetched `sindresorhus/p-limit` PRs #109 and #108 through the real backend,
verified displayed counts, and exercised missing-provider feedback with no browser
JavaScript errors. Live OpenAI generation remains pending a configured credential.
