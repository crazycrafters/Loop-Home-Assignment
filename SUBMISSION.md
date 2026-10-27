# Final submission handoff

Submit the public repository link after the owner merges `dev` into `main`:
`https://github.com/crazycrafters/Loop-Home-Assignment`.
The latest work remains on `dev` until that owner-controlled PR is merged.

## Implemented

- Public GitHub API integration: repository metadata, PR lifecycle/change counts,
  and paginated review records, with bounded persistent caching.
- HTTP insight endpoint: delivery/review metrics, period comparisons, source evidence,
  sample sizes, and explicit limitations.
- HTTP LLM endpoint: observations, tentative hypothesis or abstention, confidence,
  rationale, exact fact citations, schema/error/cost controls.
- Responsive dashboard with metric, narrative, and source drill-down flows.
- Node and non-root Docker workflows, runtime smoke tooling, CI, architecture notes,
  next-day priorities, and AI-use disclosure.

## Before calling the submission complete

1. Review the final feature PR into `dev` and its latest application/container CI.
2. Securely configure `LLM_API_KEY` and api.openai.com access; restart/recreate.
3. Run the default live smoke and explicit `--narrative` smoke, following README.
   The live provider check is currently **pending**, not passed or simulated.
4. Read the actual generated observations/hypothesis against the cited metrics;
   verify uncertainty, abstention, and confidence are appropriate for the sample.
5. Rehearse docs/demo.md, including a source check and a couple of trade-offs.
6. Create and merge the owner-controlled `dev` → `main` PR, then submit the link
   and NOTES.md. The assistant does not open that final PR.

A ZIP alternative must include the `.git` directory per the assignment. A normal
`git archive` excludes Git history, so it is not a substitute for that requirement.
Never include `.env`, tokens, runtime databases, or local credential files in a
submission archive. The public repository route avoids copying those local files.
