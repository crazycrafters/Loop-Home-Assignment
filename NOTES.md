# Submission notes

## Run locally

With Docker Engine and Compose v2:

```sh
docker compose up --build --wait
docker compose exec -T app node scripts/smoke.mjs
```

Alternatively, Node.js 24.5+ within v24 and npm: `npm ci && npm run dev`.
The dashboard is the service's root page on port 3000. SQLite is automatic. Public
GitHub data needs no token, though a read-only `GITHUB_TOKEN` raises rate limits.
Real narratives require a securely supplied `LLM_API_KEY`; `LLM_MODEL` defaults to
`gpt-4.1-mini`. Configure these through environment settings or an ignored `.env`,
then restart/recreate. See README for Node `.env` loading and exact HTTP examples.

## Architecture and main decisions

Fastify separates HTTP construction from process startup. A fixed-origin GitHub
adapter collects default-branch PR details and reviews under explicit pagination,
size, concurrency, and time limits. Complete snapshots are atomically cached in
worker-backed SQLite. Pure metric calculations compare merged-PR cohorts over
half-open UTC periods and expose sample sizes and every contributing source.
Current backlog stays separate because current PR state cannot reconstruct history.
This small service favors bounded full snapshots over an incomplete large-repository
scan; exceeded limits are errors rather than misleading partial metrics.

The LLM receives aggregate facts, definitions, and uncertainty, without raw PR text,
identities, or source code. Shared-schema parsing and exact citation checks reject
invalid references/values; the server resolves evidence links and caps explicitly
uncalibrated confidence. These checks do not establish prose entailment or causation.
A bounded in-memory cache coalesces duplicate paid requests. The same-origin dashboard
uses browser TypeScript and safe text rendering without a separate frontend runtime.
The production container runs as a non-root user with a read-only root filesystem
and a persistent SQLite volume.

## Verified and outstanding

Automated coverage includes 78 service tests and 10 Chromium flows, including HTTP
smoke-tool execution, metrics/evidence arithmetic, upstream/provider failures,
confidence/abstention, caching, stale UI responses, and unsafe text/links. The image
build, non-root/SQLite/dependency probe, real GitHub container smoke, and restoration
of an identical cached snapshot after restart passed. Live GitHub/browser checks
used `sindresorhus/p-limit` PRs #109/#108; review behavior is covered by fixtures
because that live sample has no qualifying reviews.

**A real OpenAI generation has not been run: no provider key is configured.** After
secure setup, run the explicit `--narrative` smoke check and review the prose against
its citations before claiming the live AI demo is ready. No canned narrative replaces
this check. See docs/demo.md and SUBMISSION.md for the remaining handoff steps.

## With another day

Add conditional requests/incremental ingestion for larger repositories, cache and
upstream observability, a labeled evaluation set for factuality and appropriate
abstention, and caller-level authentication, rate limits, and cost budgets for shared
use. Historical backlog/draft metrics require timeline events. Private data would
also require access-scoped authorization and cache partitioning.

## AI assistance

An OpenAI coding assistant helped plan milestones, write the service/dashboard,
provider adapter, packaging, tests and documentation, review implementation choices,
and run automated and live GitHub/browser/container checks. Provider responses in
tests are fixtures. The repository owner reviews feature PRs and performs the final
submission review and `dev` → `main` merge.
