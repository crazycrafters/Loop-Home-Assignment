# Submission notes (updated per milestone)

## Running

See README.md for exact development, production, configuration, sync examples, and
validation commands. Node.js 24.5+ within v24 is required; SQLite needs no separate
server. Public GitHub access works without an application token.

## Architecture and decisions

The service separates application construction from startup. A fixed-origin GitHub
adapter validates and normalizes metadata, PR details, and reviews. The collector
uses default-branch PRs to prepare delivery and review metrics. It scans closed PRs
by update time but selects them by merge/closure time, and fetches old open PRs
separately so an inactive backlog is not silently lost. Source URLs and timestamps
will support evidence references in later metric and LLM milestones.

SQLite provides persistent, TTL-based snapshots without external infrastructure.
A worker keeps synchronous SQLite and stored JSON processing off the HTTP event
loop. Complete snapshots are atomically saved; bounded concurrency, pagination,
payload sizes, and collection limits keep this small service predictable. These
limits intentionally reject very large repositories rather than imply that partial
numbers are complete. Private repositories and raw text/code collection are outside
the current scope. GitHub reads are not atomic, and current backlog/draft status
cannot reconstruct historical state. These limitations are explicit in the API docs.

## Validation

Automated tests cover upstream paging/errors/limits, period boundaries and backlog,
concurrency and duplicate syncs, SQLite persistence/expiry/eviction, and HTTP errors.
A local production smoke check against `sindresorhus/p-limit` collected PR #109,
matched its change counts to a direct GitHub response, confirmed an immediate cache
hit, and confirmed the same cached snapshot after restarting the server. This real
sample had no review records; review paging and reviewer normalization are tested
with fixtures. No live LLM integration exists yet.

## With another day

After the planned metric, LLM, and dashboard milestones, prioritize conditional
requests and incremental ingestion for larger repositories, cache observability,
stronger admission controls for shared deployment, and scheduled live contract checks.
A future historical backlog metric would need timeline events rather than current
PR state. Before supporting private data, add caller authentication and authorization
and partition caches by access scope.

## AI assistance

An OpenAI coding assistant helped plan milestones, implement the foundation and
GitHub/SQLite ingestion, write tests/docs, and run automated and live validation.
Human review of each feature PR remains part of the submission workflow.
