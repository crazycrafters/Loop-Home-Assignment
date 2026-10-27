# Submission notes (updated per milestone)

## Running

See README.md for exact development, production, configuration, insights/sync examples, and
validation commands. Node.js 24.5+ within v24 is required; SQLite needs no separate
server. Public GitHub access works without an application token.

## Architecture and decisions

The service separates application construction from startup. A fixed-origin GitHub
adapter validates and normalizes metadata, PR details, and reviews. The collector
uses default-branch PRs to prepare delivery and review metrics. It scans closed PRs
by update time but selects them by merge/closure time, and fetches old open PRs
separately so an inactive backlog is not silently lost. Source URLs and timestamps
back the metric evidence and will support the later LLM milestone.

SQLite provides persistent, TTL-based snapshots without external infrastructure.
A worker keeps synchronous SQLite and stored JSON processing off the HTTP event
loop. Complete snapshots are atomically saved; bounded concurrency, pagination,
payload sizes, and collection limits keep this small service predictable. These
limits intentionally reject very large repositories rather than imply that partial
numbers are complete. Private repositories and raw text/code collection are outside
the current scope. GitHub reads are not atomic, and current backlog/draft status
cannot reconstruct historical state. These limitations are explicit in the API docs.

Metrics are pure calculations over that snapshot. The insights service fetches the
combined current/baseline window once, so each comparison shares a source timestamp
and avoids duplicate PR/review requests. Cohorts use merge timestamps, while review
metrics include eligible pre-merge reviews on those PRs, even when submitted before
the requested period. Unknown identities and missing samples remain explicit. The
API returns definitions, sample sizes, quality flags, and every contributing PR so
a reviewer can reproduce the results. Current backlog stays separate from historical
periods; medians are not treated as additive or as evidence of causation.

## Validation

Automated tests cover upstream paging/errors/limits, period boundaries and backlog,
concurrency and duplicate syncs, SQLite persistence/expiry/eviction, and HTTP errors.
A local production smoke check against `sindresorhus/p-limit` collected PR #109,
matched its change counts to a direct GitHub response, confirmed an immediate cache
hit, and confirmed the same cached snapshot after restarting the server. This real
sample had no review records; review paging and reviewer normalization are tested
with fixtures. A second live production check validated August 2026 insights
against GitHub PR #109 and the equal-duration baseline against PR #108, reproducing
both periods' merge-time and changed-line medians from direct source responses.
Identical results survived cache hits and a process restart. Hand-calculated
fixtures cover review eligibility, duration medians, concentration, rankings, sample
sizes, missing/zero baselines, UTC/DST boundaries, and evidence reconciliation.
No live LLM integration exists yet.

## With another day

After the planned LLM and dashboard milestones, prioritize conditional
requests and incremental ingestion for larger repositories, cache observability,
stronger admission controls for shared deployment, and scheduled live contract checks.
A future historical backlog metric would need timeline events rather than current
PR state. Before supporting private data, add caller authentication and authorization
and partition caches by access scope.

## AI assistance

An OpenAI coding assistant helped plan milestones, implement the foundation and
GitHub/SQLite ingestion and metric calculations, write tests/docs, and run automated and live validation.
Human review of each feature PR remains part of the submission workflow.
