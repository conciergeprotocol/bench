# CAP benchmark

When does a visiting agent do better asking a store's CAP front door than reading the store's website, and when does it not?

This repository holds a synthetic store, the tasks, and the scorer. The same record feeds a clean storefront, a storefront with faults seen on real sites, and the CAP concierges. Only the interface changes between conditions.

Status: building. Nothing here is a result.

## Run

```bash
git submodule update --init
bun install
bun run check
```

That builds the record from its seed, builds the tasks, checks every expected answer against the record, checks both storefronts page by page, checks that the concierge's tools reach every expected answer, and runs the CAP smoke test with a stub answer. None of it calls a model.

- `bun run fixture` writes `record/record.json` and `record/faults.json`. They are generated, so they are not committed.
- `bun run tasks` writes `tasks/tasks.json` and `tasks/REVIEW.md`.
- `bun run validate` fails if any task disagrees with the record.
- `bun run store:clean` and `bun run store:realistic` serve the storefronts on ports 4101 and 4102. Set `CAP_URL` to serve an `agent.txt` that points at a front door.
- `bun run concierge` serves the reference concierge on port 4201. It needs `ANTHROPIC_API_KEY` in the environment, or `CONCIERGE_STUB=1` for protocol tests.
- `SMOKE_LIVE=1 bun run smoke` runs the smoke test against Claude Sonnet 5.
- `bun run conformance` runs the pinned reference server's own checks.
- `SMOKE_CAP_URL=https://host/cap/v1 bun run smoke` runs the smoke test against another CAP front door.

The concierge and storefront run on Node, because the reference server uses `node:sqlite`.

## Layout

```text
fixture/      Seeded catalog, stores, shipping, returns, and the fault plan
tasks/        Queries, task builder, answer schema, validator, and the review sheet
storefront/   Server-rendered store, clean and realistic variants, and its page checks
concierge/    The reference CAP concierge: catalog tools, the Sonnet 5 answer hook, and the smoke test
vendor/cap/   The CAP reference server, pinned as a submodule
harness/      Visitor loop: the reference fetch server, Playwright MCP, and the CAP MCP server
scorer/       Deterministic scoring of submit_answer against the record
lib/          Seeded random numbers and model prices
```

`bun run freeze` hashes every frozen file into `results/freeze.json`, which is committed and its commit hash published. `bun run main` runs the frozen plan in `FREEZE.md`: the 600-run main run, then the catalog-size and weaker-visitor arms. It stops if a frozen file changes, resumes where it left off, and writes `results/raw/main-summary.json`.

`bun run score` checks the scorer against all 50 tasks. `bun run probe` checks that the reference fetch server reads the storefront and stops at 5,000 characters. `bun run pilot` runs the 10-task pilot, one run per condition, in a shuffled order. `bun run prove` runs the follow-up: Sonnet 5 and Haiku 4.5 on the pilot tasks, then the same three tasks at 402, 5,000, and 50,000 styles on a heavier paginated store. Its numbers stay in `results/raw/` and are not a result. `bun run run -- --task FP-01 --condition fetch_clean` runs one live task. Add `--model` and `--styles` to change the visitor or the catalog size. Conditions: `fetch_clean`, `fetch_real`, `browser_real`, `fetch_heavy`, `browser_heavy`, `cap_ref`, `cap_url`.

`cap_url` runs the same tasks against any CAP front door: `--cap-url https://host/cap/v1`, with `--cap-pace 6/60,60/3600` when the door limits messages per caller. The door must answer from the same record, which the fixture generates from its seed. The result lists the CAP message ids, so the door's owner can price their side. `BENCH_RAW` writes results to another directory and `BENCH_RUN_ID` names the run, so an implementation can run the benchmark from its own repository and publish its own numbers.

The browser condition is Playwright MCP with accessibility snapshots. The harness does not give it the screenshot tool or the unsafe code tool. Fetch is `mcp-server-fetch` 2026.10.19, clamped at 5,000 characters a call, allowed to reach localhost, and still honoring robots.txt. CAP conditions use `@conciergeprotocol/mcp`. The visitor is Claude Opus 5.5 at the API's default effort, with thinking display set to summarized so the traces keep the reasoning text. A run fails at 180 seconds or $2 of visitor spend. Waiting out a front door's rate limit is not part of the 180 seconds. The harness stops at $300.

Still to come: `report/`.

## Storefront faults

The realistic variant applies the faults in `fixture/faults.mjs`, on the pages `record/faults.json` lists. Everything the client script fills in is absent from server HTML, so a fetch-only agent sees placeholders where a browser agent sees values. The clean variant puts every fact in server HTML.

## Rules for changing anything

Expected answers come only from the queries in `tasks/queries.mjs`. Never edit `tasks.json` by hand. Change a seed, a query, or the builder, then rebuild and review.

Once a run is frozen, its commit is the version. A change after that is a new version and a new run.
