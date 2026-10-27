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
back both metric evidence and LLM fact citations.

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

The LLM adapter sends aggregate facts and uncertainty rather than raw collaboration
text or identities. Strict output parsing and exact citation checks reject fabricated
fact references/values, while the server resolves evidence links itself. Confidence
is transparently capped and labeled uncalibrated, and unsupported hypotheses must
abstain. This does not prove that the prose entails its citations; live model quality
must still be evaluated. Bounded per-process caching/coalescing reduces duplicate
paid calls, but shared deployment needs additional auth and billing controls.

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
The narrative HTTP pipeline is validated with provider fixtures and real SQLite,
including error paths, unsupported hypotheses, exact evidence matching, confidence
caps, and cache behavior. A production process smoke check verified health and the
missing-provider-key 503 response. **No live OpenAI generation was run:** the
provider credential is not configured. See docs/narratives.md for the exact live
check to perform once LLM_API_KEY is supplied securely.

## With another day

After the planned dashboard milestone, prioritize conditional
requests and incremental ingestion for larger repositories, cache observability,
stronger admission controls for shared deployment, scheduled live contract checks,
and a labeled evaluation set for narrative accuracy and appropriate abstention.
A future historical backlog metric would need timeline events rather than current
PR state. Before supporting private data, add caller authentication and authorization
and partition caches by access scope.

## AI assistance

An OpenAI coding assistant helped plan milestones, implement the foundation and
GitHub/SQLite ingestion, metric calculations, and the LLM adapter, write tests/docs,
and run automated and live GitHub validation. LLM responses in tests are fixtures.
Human review of each feature PR remains part of the submission workflow.
