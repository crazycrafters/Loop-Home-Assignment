# Submission notes (updated per milestone)

## Running

See README.md for exact development, production, configuration, and validation commands.

## Decisions

The initial service keeps application construction separate from network startup.
Tests use Fastify injection to check response semantics without relying on a fixed
port. SQLite persistence and upstream adapters will arrive in later milestones;
there is no reason to provision external infrastructure for this foundation.

## With another day

After completing the remaining milestones, prioritize live upstream contract checks,
cache observability, and operational limits based on representative repository sizes.

## AI assistance

An OpenAI coding assistant helped plan milestones, implement this foundation, write
its tests and documentation, and run local validation. Human review of each feature
PR remains part of the submission workflow.
