# Freeze

The main run uses only what is committed with `results/freeze.json`. `harness/main.mjs` hashes the frozen files before every run and stops if any differ. A change after the main run starts means a new version and a new run.

## Run plan

| Phase | What | Runs |
| --- | --- | --- |
| `main` | 50 tasks, 5 categories, conditions Fetch-clean, Fetch-real, Browser-real, and CAP-ref, 3 runs each, Opus 5.5 visitor | 600 |
| `arm-scale` | SCALE-NAME, SCALE-CHEAP, and SCALE-SHIP at 402, 5,000, and 50,000 styles, on Fetch-heavy, Browser-heavy, and CAP-ref, 3 runs each | 81 |
| `arm-weak` | The 10 pilot tasks with Sonnet 5 and Haiku 4.5 visitors, on Fetch-real, Browser-real, and CAP-ref, 3 runs each | 180 |

Run order is shuffled by a fixed seed within each phase. Spend stops at $300.

## Hypotheses, stated before the main run

1. Fact on one page: CAP-ref and Fetch-clean succeed at about the same rate. CAP-ref is slower.
2. Multi-constraint: CAP-ref succeeds more often than Fetch-real and Browser-real, with fewer false claims.
3. Page versus record: CAP-ref gives the record. Fetch-real and Browser-real give the page more often than not.
4. Categories 2 to 5: CAP-ref costs less per success than Browser-real, counting both sides.
5. Catalog size: CAP-ref cost per success changes little from 402 to 50,000 styles. Fetch and Browser cost rises on tasks that span the catalog.
6. Weaker visitors: Sonnet 5 and Haiku 4.5 reading the realistic site give the page instead of the record more often than they do through CAP-ref.
7. Catalog query: CAP-ref succeeds more often than Fetch-real, which cannot use the filters, and costs less per success than Browser-real.

## Known before the freeze

The pilot and the screen are not results and are not published. They showed:

- A capable visitor gets the same answers by reading as by asking on most single-item tasks. The difference is cost and steps.
- Every miss by a reader in the screen was a list-all catalog query where the reader found some of the matches.
- The two newest help-versus-policy tasks (opened socks, an exchange after the window) passed in every condition. They stay in the set.
