# Loop repository insights

A TypeScript service that collects public GitHub pull-request and review data for
repository delivery insights. Milestones 1–3 provide GitHub ingestion, SQLite caching,
and period-based delivery/review metrics with source evidence. LLM narratives and
the dashboard will arrive in later feature PRs into `dev`.

## Quickstart

Requires Node.js **24.5 or newer within v24** and npm (`.nvmrc` selects v24).
No database server or API token is required for public GitHub data.

```sh
npm ci
npm run dev
```

In another terminal:

```sh
curl --fail http://127.0.0.1:3000/health
curl --fail-with-body --get http://127.0.0.1:3000/api/repos/sindresorhus/p-limit/insights \
  --data-urlencode 'from=2026-08-01T00:00:00Z' \
  --data-urlencode 'to=2026-09-01T00:00:00Z'
curl --fail-with-body http://127.0.0.1:3000/api/repos/sindresorhus/p-limit/sync \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-08-01T00:00:00Z","to":"2026-09-01T00:00:00Z"}'
```

The health endpoint returns `{"status":"ok"}` and checks process liveness, not
GitHub or storage readiness. Sync returns the collected `snapshot` and
`cache: { "hit": false, "ttlSeconds": 300 }`. An immediate repeat returns the same
snapshot with `hit: true` and makes no upstream requests.

For a production build:

```sh
npm run build
npm start
```

`npm run check` runs strict type checking, offline tests, and production compilation.
CI runs the same command on PRs into `dev` and `main`. The tests use upstream fixtures
and real SQLite; they need no network access or tokens.

## Insights API

`GET /api/repos/{owner}/{repo}/insights?from=<timestamp>&to=<timestamp>`

Returns throughput, merge and first-review timing, change size, review coverage,
reviewer concentration, and contributor/reviewer tables. Every metric includes
its sample size and references to PR evidence with source links. The response
compares the requested period with the preceding equal-duration period and reports
current backlog separately. Empty timing samples return `null`, not zero.

No preceding sync call is required: the endpoint collects and caches both periods
in one source snapshot. Use ISO-8601 timestamps with a timezone and a positive
period no longer than 90 days. Collection may therefore cover up to 180 days;
existing collection limits apply to that combined source window. For August 1–
September 1, the baseline is July 1–August 1. Review metrics cover **PRs merged in
the period**, including their earlier reviews, not all reviews posted repository-wide.

See [metric definitions and evidence](docs/metrics.md) for exact populations,
formulas, missing-data behavior, comparison semantics, and interpretation limits.
Source errors propagate rather than masquerading as zero metrics.

## Sync API

`POST /api/repos/{owner}/{repo}/sync`

The JSON body must contain only `from` and `to`: ISO-8601 timestamps with a timezone,
with a positive period of at most 90 days. Boundaries are **from inclusive, to
exclusive**, normalized to UTC. Repository names are validated and all requests go
to the fixed `https://api.github.com` origin. Only public repositories are supported,
even when a token could access private repositories.

A complete snapshot contains:

- Repository identity and default branch.
- PRs targeting that branch that were **merged or closed during the period**.
- A separate population of **currently open PRs**, including inactive PRs older than
  the period. Filter `pulls` by `state` to distinguish the populations. Open backlog
  describes collection time, not the historical end of the period.
- For every included PR: source URL, author (nullable for deleted accounts), state,
  current draft status, creation/update/closure/merge timestamps, lines added/deleted,
  changed-file count, and submitted/pending review records with reviewer, decision,
  and timestamp. Raw source code, diffs, titles, and comment bodies are not persisted.

`fetchedAt` records completion time. GitHub reads are not an atomic snapshot; activity
may change during collection. Draft status, review decisions (including dismissed
reviews), default branch, and open/closed state reflect current upstream data, not
historical reconstructions. A detected base-branch change during collection returns
`409 SOURCE_CHANGED` so callers can retry. Deleted accounts remain `null` rather than
being counted as a fabricated contributor. The metrics milestone will define which
review records qualify for each calculation.

### Upstream access and limits

The collector uses GitHub REST API version `2022-11-28`:

- `GET /repos/{owner}/{repo}`
- `GET /repos/{owner}/{repo}/pulls` (separate open and closed scans, default-branch filter)
- `GET /repos/{owner}/{repo}/pulls/{number}`
- `GET /repos/{owner}/{repo}/pulls/{number}/reviews`

Pages contain up to 100 items. Closed PRs are scanned by descending update time,
stopping once updates predate `from`; merge/closure timestamps determine inclusion.
At most three detail/review requests run concurrently per sync, with two distinct
syncs admitted per process. Identical in-flight requests share the same collection.
Requests time out after 10 seconds; a collection has a 120-second deadline. Transient
502/503/504 GET responses retry once; authorization and rate-limit errors do not retry.
Redirects are rejected, and upstream pagination URLs are never followed.

Bounds: 20 pages per list, 200 included PRs, 1000 unique reviews per PR, 2 MiB per
upstream response, and 8 MiB per stored snapshot. Limits return explicit errors;
partial results are never cached. Choose a smaller repository or shorter period
when limits are reached. A shorter period cannot reduce the current open backlog.

Unauthenticated GitHub access normally allows 60 requests/hour; a read-only token
usually raises the limit. Fetching a fresh snapshot costs repository/list pages plus
one detail request and review pages for every included PR. API limits also depend on
GitHub's secondary limits and any proxy-supplied authentication.

### Errors

Errors have `error`, `code`, and `requestId` fields for sync-specific failures.
Malformed JSON and generic HTTP errors use the foundation's `error`/`requestId` shape.
No upstream response bodies or token values are returned.

| HTTP | Example code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid repository or date range |
| 403 | `PUBLIC_REPOSITORY_REQUIRED` | Private repositories are unsupported |
| 404 | `REPOSITORY_NOT_FOUND` | Repository/PR unavailable or removed during sync |
| 409 | `SOURCE_CHANGED` | PR base changed during collection; retry |
| 422 | `COLLECTION_LIMIT` | A documented collection/storage limit was reached |
| 502 | `GITHUB_UNAVAILABLE`, `GITHUB_INVALID_RESPONSE`, `GITHUB_ACCESS_DENIED` | Upstream transport, payload, or credential failure |
| 503 | `GITHUB_RATE_LIMITED`, `SYNC_BUSY`, `STORAGE_UNAVAILABLE` | Retryable upstream/admission/storage issue |

Rate-limited and busy responses include a bounded `Retry-After` in seconds.

## Configuration and persistence

The service reads process environment variables. `.env.example` documents defaults;
it is not automatically loaded. For a local file, copy it to `.env` and launch with
`node --use-env-proxy --env-file=.env --import tsx src/server.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` in a container when needed |
| `PORT` | `3000` | Integer from 1 through 65535 |
| `LOG_LEVEL` | `info` | Standard Pino log level or `silent` |
| `DATABASE_PATH` | `./data/loop.sqlite` | SQLite path, relative to the working directory |
| `CACHE_TTL_SECONDS` | `300` | Snapshot freshness, integer from 1 to 3600 seconds |
| `GITHUB_TOKEN` | unset | Optional read-only GitHub token for public data |

Keep tokens in environment settings or a local ignored `.env`, never in Git or logs.
An explicitly configured invalid token causes an upstream error rather than silently
falling back to anonymous access. The start/dev commands respect standard HTTP(S)
proxy environment variables and the existing TLS trust configuration.

SQLite is created automatically and runs in a worker thread, including database I/O
and cached JSON parsing/serialization. Snapshots are keyed by schema version,
case-normalized repository, and exact normalized period. Only successful complete
collections are written, atomically. Expired entries are removed on writes and the
cache retains at most 100 snapshots. Database and snapshot sizes remain bounded;
SQLite can retain allocated disk pages after eviction. `ttlSeconds` in the response
is the configured freshness duration, not a remaining-time countdown.

Mount `data/` on a persistent volume to keep snapshots across container recreation.
The database and WAL files are ignored by Git. Keep this directory private. Changing
the token does not invalidate already cached public snapshots. Expired snapshots
are not served as a fallback when GitHub is unavailable.

Invalid configuration prevents startup without printing supplied values. Request
logs redact authorization and cookie headers. Request bodies are limited to 64 KiB.
SIGINT/SIGTERM close the server and storage, with a 10-second hard shutdown deadline.

## Architecture and next milestones

`src/config.ts` validates configuration; `src/app.ts` wires routes and dependencies;
`src/server.ts` owns startup and shutdown. `src/github/client.ts` handles bounded HTTP
and pagination, `collector.ts` selects and normalizes source data, and `ingestion.ts`
coordinates caching and duplicate requests. `src/storage/` provides worker-backed
SQLite persistence. Tests exercise boundaries with fixture transports and real storage.

The pure calculations in `src/insights/metrics.ts` are separated from collection
and HTTP; `service.ts` builds both cohorts from one cached snapshot.

Next: evidence-backed LLM narratives, a lightweight dashboard, and a complete demo. Feature PRs target `dev`;
the repository owner opens the final `dev` → `main` PR. See NOTES.md for trade-offs
and AI-use disclosure.
