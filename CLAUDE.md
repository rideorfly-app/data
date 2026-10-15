# Ride or Fly: data

The public data pipeline for Ride or Fly. A daily workflow checks public sources (DOT, EIA, GSA, NHTSA, USGS, Census, FAA), turns new data into files, and opens a pull request for each update. The owner merges updates and cuts releases by hand, and the private `app` repo loads each release into D1. The full design is the "Batch data jobs" section of `../MVP Plan.md`, which is the source of truth. Check it before building or changing a job, and point out anything that conflicts with it.

This repo installs `@rideorfly/engine` from npm at a pinned version, for its row formats and, for the accuracy report, its math. It depends on the engine, never the reverse.

## About the owner

The owner is a web developer who builds custom WordPress themes and plugins. Infrastructure and DevOps are outside their usual work.

- Explain command-line, npm, and GitHub Actions steps plainly, and say what each command does before asking them to run it.
- When something resembles WordPress, use the comparison.
- Never push to `master`, merge a pull request, run the Release data workflow, or change the repo's settings without asking first.

## Rules

- **This repo is public.** Nothing private goes in: no production credentials, no app code, and no user data. The only secret is a PAT limited to starting workflows in the `.github` repo.
- **Never commit Google's route results**, including drive times or distances copied from Google Maps. Google's terms forbid storing them.
- **Each job writes only to its own repo.** Everything that produces a file runs here; other repos read the releases.
- **Released files are never edited in place.** Corrections go through a new pull request and the next release.
- **Licenses:** scripts are Apache 2.0 (`LICENSE`, `NOTICE`); data files, including the hand-kept tables, are CC BY 4.0 (`LICENSE-DATA`).
- **Scripts get the same checks as the engine:** TypeScript, type-checked, and tested with small sample files, since their output feeds real results.

## Files

| Path | What it is |
| --- | --- |
| `README.md` | What the repo holds and how it works, for the public |
| `LICENSE`, `NOTICE` | Apache 2.0, for the scripts |
| `LICENSE-DATA` | CC BY 4.0, for the data files |

The pipeline, its scripts, and the workflows aren't built yet.
