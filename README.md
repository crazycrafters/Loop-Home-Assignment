# Loop Insights

Understand how GitHub work moves: pull-request delivery and review metrics,
equal-period comparisons, and LLM explanations with verifiable fact citations.
The service includes a responsive dashboard and a directly queryable HTTP API.

## Quickstart — Docker

Requires Docker Engine and Compose v2. No host Node.js or database server is needed.

```sh
docker compose up --build --wait
docker compose exec -T app node scripts/smoke.mjs
```

Open the service's root page at `http://127.0.0.1:3000` in your own browser. Choose
**Try an example**, then **Analyze repository**. The example fetches real public
GitHub data. Optional AI generation requires a configured provider credential.
`docker compose down` stops the service while retaining its SQLite cache volume.

## Quickstart — Node.js

Requires Node.js **24.5+ within v24** (`.nvmrc` selects v24) and npm.

```sh
npm ci
npm run dev
```

In another terminal, `npm run smoke` checks the running service. Production uses
`npm run build && npm start`. Dashboard edits require rebuild/refresh; backend
modules are watched in development.

## Enable the LLM endpoint

Securely set `LLM_API_KEY` on the server and optionally `LLM_MODEL` (default
`gpt-4.1-mini`). Use environment settings or copy `.env.example` to an ignored `.env`
and populate it locally. Never put credentials in the browser, Git, or chat.
Compose reads `.env`; the Node process can load it explicitly:

```sh
npm run build
node --use-env-proxy --env-file=.env dist/server.js
```

After configuration/restart, request a real narrative deliberately:

```sh
# Docker:
docker compose exec -T app node scripts/smoke.mjs --narrative
# Node, against a running service:
npm run smoke -- --narrative
```

Without a key, the narrative endpoint returns `503 LLM_NOT_CONFIGURED`; metrics and
evidence remain available. **Live OpenAI validation is still pending a credential.**
The regular smoke check explicitly skips generation and never silently substitutes
fixture prose. A read-only `GITHUB_TOKEN` is optional for higher GitHub rate limits.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness |
| `GET /api/repos/{owner}/{repo}/insights?from=...&to=...` | Metrics, baseline changes, sample sizes, and PR evidence |
| `POST /api/repos/{owner}/{repo}/narrative` | LLM observations/hypothesis, confidence, and fact citations |
| `POST /api/repos/{owner}/{repo}/sync` | Complete cached source snapshot |

```sh
curl --fail-with-body --get http://127.0.0.1:3000/api/repos/sindresorhus/p-limit/insights \
  --data-urlencode 'from=2026-08-01T00:00:00Z' \
  --data-urlencode 'to=2026-09-01T00:00:00Z'
curl --fail-with-body http://127.0.0.1:3000/api/repos/sindresorhus/p-limit/narrative \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-08-01T00:00:00Z","to":"2026-09-01T00:00:00Z"}'
```

Periods are half-open UTC intervals of up to 90 days. Delivery metrics concern PRs
merged into the current default branch during each period; review metrics concern
qualifying reviews on that merged cohort, including earlier submissions. Current
backlog is reported separately. Missing timing is `null`, not zero. Every metric
includes sample size and evidence references. Confidence is a capped, uncalibrated
hypothesis assessment; these numbers do not establish causation or productivity.

## Verification

```sh
npm run check             # Type checking, build, service tests, Chromium flows
npm run smoke             # Running service: real GitHub/evidence/cache check
npm run smoke -- --ui-only
npm run smoke -- --narrative
```

Browser tests use `/usr/bin/chromium` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when
provided. Otherwise install one with `npx playwright install --with-deps chromium`.
Test execution uses fixtures and real SQLite, with no upstream credentials or paid
calls. CI checks both the application/browser suite and the production container.
The container job runs health/assets and a non-root/SQLite/dependency probe without
external API calls. Real GitHub/browser/container smoke checks were also run in the
current environment; live model behavior remains a separate pending check.

## Decisions, limits, and submission

TypeScript/Fastify serves API and UI; a worker keeps SQLite and cached JSON work off
the HTTP event loop. GitHub fetches use a fixed origin, pagination, deadlines,
bounded concurrency, TTL caching, and explicit size limits. The model sees aggregate
facts and methodology, while the server validates citations and resolves source
links. Citation checks do not prove the prose follows from its evidence.

Public repositories only. Snapshot collection is capped at 200 PRs, 1000 reviews
per PR, and 20 pages per list; oversized or incomplete collections fail explicitly.
Shared deployment needs caller authorization and billing/rate controls. See the
short [submission notes](NOTES.md) for trade-offs, next steps, and AI-use disclosure.

- [Ten-minute demo and smoke options](docs/demo.md)
- [Container deployment, persistence, and proxy trust](docs/deployment.md)
- [Metric definitions and evidence](docs/metrics.md)
- [LLM contract, confidence, and validation status](docs/narratives.md)
- [Dashboard usage and browser development](docs/dashboard.md)
- [Raw sync API, configuration variables, and errors](docs/api.md)
- [Final submission checklist](SUBMISSION.md)

Feature PRs target `dev`. The repository owner creates the final `dev` → `main` PR.
