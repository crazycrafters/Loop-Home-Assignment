# Evidence-backed narratives

`POST /api/repos/{owner}/{repo}/narrative`

```sh
curl --fail-with-body http://127.0.0.1:3000/api/repos/sindresorhus/p-limit/narrative \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-08-01T00:00:00Z","to":"2026-09-01T00:00:00Z"}'
```

## Setup and data flow

Set `LLM_API_KEY` securely in your environment or ignored local `.env`. Set
`LLM_MODEL` optionally; the default is `gpt-4.1-mini`. Restart the service after
configuration changes. With `.env`, run
`node --use-env-proxy --env-file=.env --import tsx src/server.ts`.
The configured model must support the Responses API and strict JSON-schema output.

The service calls `POST https://api.openai.com/v1/responses`. The provider origin
is fixed and redirects are rejected. Hosted environments need this destination
allowed and the credential bound to it. The application deliberately uses
`LLM_API_KEY` rather than a platform-reserved secret variable name. No credential
is embedded in code, Git, saved instructions, or request logs.

Each request computes the insights itself using the same cached GitHub snapshot
as the metrics endpoint. The caller supplies only repository and period, not
prompts, models, metrics, or provider URLs. The LLM receives 47 aggregate facts,
their units/sample sizes/definitions, both periods, data-quality counts, warnings,
and methodology. It does not receive repository/account names, PR URLs, raw PR
records, source code, titles, diffs, or comment bodies. The server resolves cited
fact IDs back to PR/review evidence after generation.

OpenAI requests use `store: false`, no tools, no streaming, and an 1800-output-token
budget. This disables response-object storage; it is not a claim of zero provider
retention. Requests time out after 30 seconds and response bodies are capped at
256 KiB. Paid POST requests are never automatically retried, including after a
network error where the provider may already have processed the request.

## Output and evidence

The response includes:

- `narrative`: the observation sentences followed by a hypothesis when supported.
- `observations`: 1–3 short statements, each with `{ factId, value }` citations.
- `hypothesis`: tentative text (or null), a confidence score from 0 to 1, rationale,
  and separate fact citations. Null hypotheses must have confidence 0 and no citations.
- `limitations`: model-provided caveats, alongside deterministic source `warnings`
  and `methodology` carried over from the metrics.
- `citedFacts`: exact calculated values, units, sample sizes, definitions, and PR
  evidence IDs. `evidence` contains those PR rows and qualifying review permalinks.
- `source`: repository, default branch, both periods, and source fetched time.
  `generatedAt` identifies generation time; cache hits retain that timestamp.
- `model`, `promptVersion`, `schemaVersion`, and narrative `cache` metadata.

Both provider output and server-side parsing use the same strict schema. The
server rejects unknown fact IDs, altered numeric/null citation values, duplicate
citations within a claim, broken PR evidence, invalid confidence values, and
common URL/markup forms in prose. A non-null hypothesis needs at least two
non-null, source-backed facts about distinct metrics and at least one current or
change fact. If the current cohort has no merged PRs, the model must abstain.
Failures return an error; there is no canned success narrative or fabricated fallback.

Schema and citation validation verify structure and cited numbers, **not whether
natural-language prose logically follows from them**. A model can still misinterpret
a correct fact. Read the narrative with its evidence and limitations, and render
model text as plain text rather than executable HTML/Markdown. Real-model semantic
evaluation remains a separate check from deterministic fixture tests.

## Confidence

`hypothesis.confidence` is model-assessed plausibility after server caps. It is not
a calibrated probability, a significance test, or confidence in the arithmetic.
`confidencePolicy` reports the original model score, cap, and smallest cited sample.

The cap uses the smallest cited metric sample size: 0.35 below five, 0.5 for
five through nine, and 0.75 for ten or more. Incomplete periods, unknown authors, or invalid merge
durations cap it at 0.35. Abstention sets the cap and confidence to zero. The
server never raises the model score. Caps are transparent conservative heuristics,
not a statistical model; causation still requires investigation beyond these metrics.

## Caching and cost controls

The in-process narrative cache uses the configured `CACHE_TTL_SECONDS`. Keys include
model, prompt version, repository, source timestamp, facts, and quality context.
A refreshed GitHub snapshot triggers a fresh narrative. Identical concurrent
requests share one provider request; only one distinct generation runs per process.
Additional distinct requests receive 503 `NARRATIVE_BUSY` with `Retry-After: 5`.

Only validated successes are cached. The cache retains at most 50 entries and
8 MiB of serialized results; results over 1 MiB are returned but not retained.
These are serialized-size bounds, not exact JavaScript heap-size measurements.
Narratives are not persisted to SQLite, so a process restart may incur another
provider call even when GitHub data is still cached. Source freshness is checked
before narrative-cache lookup; source errors propagate rather than serving stale
prose as fresh. Per-process admission/TTL limits are not a deployment-wide billing
budget. Add caller authentication and rate/budget controls before shared deployment.

## Failure contract and validation status

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid repository/period or extra request fields |
| 503 | `LLM_NOT_CONFIGURED` | Supply the provider credential; GitHub is not fetched first |
| 503 | `NARRATIVE_BUSY`, `LLM_RATE_LIMITED` | Retry guidance is supplied |
| 502 | `LLM_ACCESS_DENIED`, `LLM_UNAVAILABLE` | Credential/model/provider failure |
| 502 | `LLM_REFUSED`, `LLM_INVALID_RESPONSE`, `LLM_INVALID_EVIDENCE` | Refusal, malformed/incomplete output, or invalid citations |
| 504 | `LLM_TIMEOUT` | Provider deadline exceeded |

Existing GitHub/collection/storage errors also propagate. Upstream error bodies
and raw transport exceptions are not exposed.

Automated tests use fixture provider responses and real SQLite for the HTTP pipeline.
They cover abstention, exact citation matching, unsupported hypotheses, confidence
caps, invalid output/refusals, timeouts, duplicate-generation coalescing, cache expiry,
source refresh, eviction, and missing configuration. A production HTTP smoke check
verified health and the missing-key error path with graceful shutdown.

A live OpenAI generation has **not** been validated: no `LLM_API_KEY` is currently
configured. After configuring a valid key and destination access, run the request
above, verify the narrative's factual statements and citations against the insights
endpoint, and repeat it to confirm a narrative cache hit. The tiny example cohort
should produce cautious language or abstention, not a confident causal conclusion.
