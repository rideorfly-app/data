# Ride or Fly: data

The public data pipeline for Ride or Fly. Each dataset has its own job, which checks a public source (DOT, EIA, GSA, NHTSA, USGS, Census, FAA) for new data and makes its file. A daily workflow runs every job and opens a pull request for each update. The owner merges updates and cuts releases by hand, and the private `app` repo loads each release into D1. The full design is the "Batch data jobs" section of `../MVP Plan.md`, which is the source of truth. Check it before building or changing a job, and point out anything that conflicts with it.

This repo installs `@rideorfly/engine` at a pinned version, for its row formats and, for the accuracy report, its math. Until the engine is on npm, it installs from a pinned commit on GitHub, which works because the engine builds itself on install. Move the pin up with each engine change `data` needs. It depends on the engine, never the reverse.

## About the owner

The owner is a web developer who builds custom WordPress themes and plugins. Infrastructure and DevOps are outside their usual work.

- Explain command-line, npm, and GitHub Actions steps plainly, and say what each command does before asking them to run it.
- When something resembles WordPress, use the comparison.
- Never push to `master`, merge a pull request, run the Release data workflow, or change the repo's settings without asking first.

## Rules

- **This repo is public.** Nothing private goes in: no production credentials, no app code, and no user data. The only secrets are a PAT limited to starting workflows in the `.github` repo and, if a source turns out to need one, a read-only key for public data.
- **Never commit Google's route results**, including drive times or distances copied from Google Maps. Google's terms forbid storing them.
- **Each job writes only to its own repo.** Everything that produces a file runs here; other repos read the releases.
- **Data changes only through pull requests,** except the one-time backfill (see Getting started). A correction, or a new review of a hand-kept table, edits the file in a pull request and goes out in the next release. Earlier releases keep the old version, since each release is a locked label on a commit.
- **Licenses:** scripts are Apache 2.0 (`LICENSE`, `NOTICE`); data files, including the hand-kept tables, are CC BY 4.0 (`LICENSE-DATA`).
- **Scripts get the same checks as the engine:** TypeScript, type-checked, and tested with small sample files, since their output feeds real results.
- **Flight history covers the Lower 48 and DC only:** a flight counts when both ends are there, matching the app's launch area. Adding Alaska and Hawaii later means rebuilding every month.
- **Two reliability figures, named like the engine's:** `delayShare` is the share of flights that flew and arrived 15 minutes or more late; `disruptShare` is the share of all flights that were cancelled or diverted. Diverted flights are in `disruptShare` only, not in the delay figures, since DOT gives them no arrival delay.
- **"Delayed" is DOT's rule:** 15 minutes or more late, the same as BTS's `ArrDel15` flag. A test keeps a flight at exactly 15 minutes in the sample.
- **Airport rows cover every flight in or out of the airport,** each measured by its arrival delay at its own destination, so they blend the airport's arrivals with the delays of flights leaving it. DOT's own per-airport tables count arrivals only, so compare with an arrivals-only recomputation. The engine uses airport rows only to borrow a seasonal pattern for thin routes.
- **Files are reproducible:** one row per line, keys in a fixed order, rows sorted, so the same source gives the same bytes.

## Files

| Path | What it is |
| --- | --- |
| `README.md` | What the repo holds and how it works, for the public |
| `LICENSE`, `NOTICE` | Apache 2.0, for the scripts |
| `LICENSE-DATA` | CC BY 4.0, for the data files |
| `src/cli.ts` | Runs a job locally; jobs are the folders in `src/` other than `lib/` |
| `src/lib/` | Shared helpers: `job.ts` (a job's shape), `download.ts`, `csv.ts` (reads a zipped CSV), `months.ts`, `write.ts` (the file format) |
| `src/flight-history/` | The flight-history job: `aggregate.ts` (DOT records to rows), `checks.ts` (sanity ranges), `summary.ts` (pull request text), `index.ts` (the job) |
| `test/` | Vitest tests; `test/flight-history/` has a made-up zipped CSV of nine flights |
| `datasets/` | Everything published (CC BY 4.0), one row per line, including the hand-kept tables, one file each, edited in place. Empty on `init` |
| `.github/workflows/tests.yml` | Lint, types, and tests on pushes and pull requests |

Not built yet ("Jobs, workflows, and layout" in the plan): the other datasets' jobs (`src/<job>/`, with tests in `test/<job>/`), the accuracy report, the manifest, and the `daily.yml` (runs every job), `job.yml` (one job; also run by hand), and `release.yml` (the Release data button) workflows.

## Commands

| Task | Command |
| --- | --- |
| Install (also builds the pinned engine) | `npm install` |
| Tests | `npm test` |
| Tests with the coverage report | `npm run coverage` |
| Format and lint (fix with `npm run format`) | `npm run check` |
| Types | `npm run typecheck` |
| Everything CI runs | `npm run verify` |
| Is there new data? | `npm run job -- flight-history --check` |
| Make one month | `npm run job -- flight-history --month 2026-08` |
| Make a range | `npm run job -- flight-history --from 2022-01 --to 2026-08` |

Downloads are cached in `.cache/` (ignored by Git). Node runs the TypeScript directly, so there's no build step; imports use `.ts` extensions.

## Getting started

- Initial work happens on the `init` branch, with a pull request into `master`. `init` never commits datasets: `datasets/` is in the local exclude list (`.git/info/exclude`), so files made while testing stay untracked.
- The backfill (January 2022 to the newest month) runs locally. Before it, `datasets/` comes off the exclude list, and the owner turns `master`'s pull-request rule off just long enough to push it straight to `master`, then back on.
