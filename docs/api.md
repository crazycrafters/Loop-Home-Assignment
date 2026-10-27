# Raw sync API and service configuration

See [metrics](metrics.md) and [narratives](narratives.md) for the two insight endpoints.

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
being counted as a fabricated contributor. Review eligibility is defined in [metric methodology](metrics.md).

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
| `LLM_API_KEY` | unset | Provider credential required only for narratives |
| `LLM_MODEL` | `gpt-4.1-mini` | Responses API model supporting strict JSON-schema output |

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

