# Ten-minute walkthrough

## Before the conversation

1. Run `docker compose up --build --wait` or `npm ci && npm run dev`.
2. Run the default smoke check below to confirm real GitHub access, assets, evidence,
   and cache behavior. A read-only GitHub token helps avoid public rate limits.
3. Configure `LLM_API_KEY` securely, restart/recreate the service, and run the explicit
   narrative check. It must succeed before presenting a working live AI demo.
4. Read the actual narrative against its cited numbers; correct references alone
   do not establish a sensible explanation. Keep source/sample caveats visible.

Docker commands:

```sh
docker compose exec -T app node scripts/smoke.mjs
docker compose exec -T app node scripts/smoke.mjs --narrative
```

Node commands (against a running service):

```sh
npm run smoke
npm run smoke -- --narrative
```

The default check uses public `sindresorhus/p-limit` from August 1 to before
September 1, 2026. It has a deliberately small live sample: PR #109 in the selected
period and #108 in the baseline, with no qualifying reviews. This demonstrates
source verification, missing review timing, and cautious interpretation. Use a
representative public repository of your choosing for richer review signals; keep
within collection/rate limits and do not substitute canned results for live data.

## 0:00–2:00 — What the service measures

Open the dashboard root page, choose **Try an example**, and analyze. Explain the
half-open UTC interval and the preceding equal-duration baseline. Show throughput,
creation-to-merge time, review coverage, and sample sizes. Open quality notes; one
PR per period is descriptive evidence, not a basis for confident causal claims.

## 2:00–4:00 — Follow the evidence

Click a metric's source action, expand a PR, and open its GitHub source. Explain
why unreviewed PRs have missing review latency rather than zero. Show current open
backlog separately from historical merged cohorts. Open **View API response** to
demonstrate direct HTTP access, definitions, and calculation evidence.

## 4:00–6:00 — AI explanation

With the provider configured, click **Generate explanation**. Follow an observation's
fact chip to its contributing PRs. Discuss a tentative hypothesis or an explicit
abstention, capped and uncalibrated confidence, and limitations. A tiny sample may
appropriately abstain. If no key is configured, show the honest unavailable state
and explicitly disclose that the live AI requirement still needs validation.

## 6:00–8:00 — Code tour

- `src/github/client.ts` and `collector.ts`: bounded, fixed-origin HTTP, pagination,
  period selection, and normalized PR/review records.
- `src/storage/`: worker-backed SQLite, atomic complete snapshots, TTL and limits.
- `src/insights/metrics.ts`: pure calculations, explicit cohorts and sample sizes.
- `src/narrative/`: aggregate-only model input, shared schema, exact citation checks,
  abstention, and confidence/cost controls.
- `src/dashboard/`: type-only contracts, safe DOM text, stale-request/source guards.

## 8:00–10:00 — Trade-offs and next work

Explain bounded full snapshots versus incremental ingestion, current versus
historical backlog, calendar versus business-hour timing, and why citation
validation does not prove causal or semantic correctness. Discuss a labeled model
evaluation set, conditional requests, and caller-level auth/budgets for shared use.
Close with the passing automated checks and disclose which live integrations were
actually exercised.

## Smoke options and interpretation

```sh
npm run smoke -- --base-url http://127.0.0.1:8080 \
  --repository owner/repository \
  --from 2026-08-01T00:00:00Z --to 2026-09-01T00:00:00Z
npm run smoke -- --ui-only
```

`--ui-only` checks packaged HTTP assets without upstream calls. The default full
check requires at least one merged PR across the periods so empty data cannot
masquerade as a representative integration check. It reconciles merge/review counts,
merge timing, evidence references, baseline duration, and an immediate cache hit.
`--narrative` adds citation/confidence checks and an immediate narrative cache check.
It fails with a nonzero exit code on missing credentials or provider errors; these
are not treated as passing AI checks. Human review of prose remains necessary.
Immediate cache checks assume a freshness window longer than the check's runtime;
use the default 300-second TTL during the walkthrough.
