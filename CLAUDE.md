# Ride or Fly: data

The public data pipeline for Ride or Fly. Each dataset has its own job, which checks a public source (DOT, EIA, GSA, NHTSA, USGS, Census, FAA) for new data and makes its file. A daily workflow runs every job and opens a pull request for each update. The owner merges updates and cuts releases by hand, and the private `app` repo loads each release into D1. The full design is the "Batch data jobs" section of `../plan/MVP Plan.md`, which is the source of truth. Check it before building or changing a job, and point out anything that conflicts with it.

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
- **Airport rows cover every flight in or out of the airport,** each measured by its arrival delay at its own destination, so they blend the airport's arrivals with the delays of flights leaving it. DOT's own per-airport tables count arrivals only, so compare with an arrivals-only recomputation. The engine blends an airport's same-month average into a small route's own average.
- **Files are reproducible:** one row per line, keys in a fixed order, rows sorted, so the same source gives the same bytes.

## Files

| Path | What it is |
| --- | --- |
| `README.md` | What the repo holds and how it works, for the public |
| `LICENSE`, `NOTICE` | Apache 2.0, for the scripts |
| `LICENSE-DATA` | CC BY 4.0, for the data files |
| `src/cli.ts` | Runs a job locally; jobs are the folders in `src/` other than `lib/` |
| `src/lib/` | Shared helpers: `job.ts` (a job's shape), `download.ts`, `zip.ts` (reads a text file inside a zip, by line or whole), `csv.ts` (reads a zipped CSV), `xlsx.ts` (reads a spreadsheet), `docx.ts` (reads the tables in a Word file), `xml.ts`, `months.ts`, `write.ts` (the file format) |
| `src/flight-history/` | The flight-history job: `aggregate.ts` (DOT records to rows), `checks.ts` (sanity ranges), `summary.ts` (pull request text), `index.ts` (the job) |
| `src/accuracy/` | The accuracy report job: `history.ts` (reads the flight-history files, and only the months up to a date), `flights.ts` (a month's flights by route and day), `score.ts` (what the engine would have estimated, and how close it came), `report.ts` (the file's rows), `engine.ts` (checks that the installed engine is the one `package.json` pins), `summary.ts` (pull request text), `rollup.ts` (combines months into one table), `index.ts` (the job) |
| `src/gas-prices/` | The weekly gas-prices job: `series.ts` (which of EIA's series, and reading its file), `checks.ts` (sanity ranges), `summary.ts` (pull request text), `index.ts` (the job) |
| `src/per-diem/` | The yearly per diem job: `links.ts` (finds GSA's files on its listing page), `read.ts` (reads the ZIP-code spreadsheet and the meals table), `checks.ts` (sanity ranges), `summary.ts` (pull request text), `index.ts` (the job) |
| `test/` | Vitest tests; `test/flight-history/` has a made-up zipped CSV of nine flights, and `test/accuracy/` a small made-up history, `test/gas-prices/` a made-up copy of EIA's file (`PET.txt`, zipped), `test/lib/` a tiny spreadsheet and Word file for the readers, and `test/per-diem/` a miniature of GSA's ZIP-code file and files page |
| `datasets/` | Everything published (CC BY 4.0), one row per line, including the hand-kept tables, one file each, edited in place. Empty on `init` |
| `.github/workflows/tests.yml` | Lint, types, and tests on pushes and pull requests |

Not built yet ("Jobs, workflows, and layout" in the plan): the jobs for road safety, winter passes, airports, and places and ZIPs, the two hand-kept tables (rental rates, airport parking), the manifest, and the `daily.yml` (runs every job), `job.yml` (one job; also run by hand), and `release.yml` (the Release data button) workflows.

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
| Make a range | `npm run job -- flight-history --from 2021-01 --to 2026-08` |
| Accuracy report for one month (needs flight history from 6 months earlier through that month) | `npm run job -- accuracy --month 2024-11` |
| Combine accuracy reports | `node src/accuracy/rollup.ts 2023-01 2025-12` |
| Is there a new week of gas prices? | `npm run job -- gas-prices --check` |
| Make one week of gas prices (the Monday) | `npm run job -- gas-prices --update 2026-10-26` |
| Is there a new year of per diem rates? | `npm run job -- per-diem --check` |
| Make a year of per diem rates | `npm run job -- per-diem --update FY2027` |

Downloads are cached in `.cache/` (ignored by Git). Node runs the TypeScript directly, so there's no build step; imports use `.ts` extensions.

## Getting started

- Initial work happens on the `init` branch, with a pull request into `master`. `init` never commits datasets: `datasets/` is in the local exclude list (`.git/info/exclude`), so files made while testing stay untracked.
- The backfill (January 2021 to the newest month) runs locally. Before it, `datasets/` comes off the exclude list, and the owner turns `master`'s pull-request rule off just long enough to push it straight to `master`, then back on. Signed commits, no force pushes, and no deletion stay on throughout.
- After the backfill, tighten the sanity ranges in `src/flight-history/checks.ts`. They are deliberately loose (set from three months). Narrow them to the spread of all the months, with a margin, so a broken file still fails.

## How the flight-history job was checked

Run on August 2026, January 2022, and November 2024 (about 30 MB each, cached in `.cache/`):

- **Every row recomputed independently** with separate code. Zero mismatches in all three months, and the delayed-flight count equals BTS's own `ArrDel15` flag total.
- **DOT's *Air Travel Consumer Report* for November 2024** (the January 2025 edition) matches exactly: 575,404 records, 488,033 on time, 2,629 cancelled, and 842 diverted for the whole file (its Table 7A), and the arrivals and on-time percentage at Boston, Dayton, Bozeman, Daytona Beach, Abilene, and Aberdeen (Table 5). DOT's own site blocks automated downloads; the BTS archive copy (`rosap.ntl.bts.gov`) can be fetched. The Lower 48 and DC file keeps 95.7% of those records.
- To repeat a check, recompute from the cached zip with a few lines of Python (`csv` and `zipfile`) and compare. The job's rules are in `aggregate.ts`.

## How the accuracy report was checked

The job (`src/accuracy/`) was run for every month from January 2023 to December 2025 (36 reports, local and uncommitted like the flight history), using flight history from January 2017. It tests the engine's three methods (the pinned commit `020adef`): `average` (the same month averaged over the past five years, skipping 2020, blended with the airports' figures for small routes), `last-year` (the same month last year), and `newest` (the newest month alone).

- **Route-days recomputed independently.** Three route-days in November 2024 (DAL-HOU, ATL-LGA, DEN-LAX) and the total of 72,310 route-days with three or more flights match a separate Python recomputation from the cached zip, to the minute.
- **An estimate recomputed independently.** The `average` method, rebuilt in Python from the flight-history files for November 2024 at 3 months ahead, gives the job's numbers exactly: 5,082 routes, 547,204 flights, an average delay off by 5.99 minutes, bias +2.09, delayed-share off by 0.0499, disruption share off by 0.0083.
- **No peeking.** A test checks that every estimate starts from the newest month DOT would have published by then, and fails if the history returned later months.
- **The engine label is true.** A report's `engine` line comes from the pin in `package.json`, so the job refuses to run unless npm actually installed that engine (it reads npm's record, `node_modules/.package-lock.json`). A local copy linked in for testing, or a different commit, stops the run with a message to run `npm install`. This closes a gap found on 2026-10-28, when reports made with a linked engine carried the old pin's name.
- **Local history needed two exceptions.** 2020-04, 2020-05, and 2020-06 fail the flight-history checks (the pandemic collapse in flights); the engine skips 2020 anyway. 2012 to 2017 have fewer than 4,000 routes a month (3,609 to 4,031, and every month but 2013-12 is under), below the floor in `checks.ts`, which was set from three recent months. From January 2018 the count is about 4,900 to 5,600 (the reason for the jump was not checked). Those months were built with a scratch script that waived only that floor. The floor is for the backfill from 2021; it needs no change for this.

What the 36 months showed (the rolled-up table is `node src/accuracy/rollup.ts 2023-01 2025-12`):

- **Delay figures, average delay off by per route, 3 months ahead:** `average` 7.6 minutes, `last-year` 9.5, `newest` 11.2. At 6 months ahead: 7.5, 9.5, 11.2. `average` is also best on delayed-flight share (6.3% off, against 7.8% and 9.2%) and on cancellations and diversions (1.7%, against 2.0% and 2.1%). It beat `last-year` in each of 2023, 2024, and 2025 (7.6, 7.7, and 7.4 minutes against 9.5, 9.3, and 9.8).
- **Why `average`:** a first experiment, run with a scratch script outside the repos, found that every extra month a method stacks up adds that month's luck. The method the plan first described (the newest month plus the seasonal change averaged over three years) was 10.1 minutes off; the owner's version with one past year was 12.0; two years were 10.7. The same month averaged over 2, 3, and 5 years was 8.7, 8.2, and 7.9; blending in the airports for small routes took five years to 7.6. A nudge for how the current year is running (the nationwide last three months against the same months in past years, half or all of it) did not improve it (7.7 with half) and was left out.
- **It runs about 2 minutes optimistic** (bias −2.1), because delays have crept up and the older years in the average pull it down. The nudge would halve that but costs accuracy elsewhere. Not fixed.
- **Flight times:** against the day's typical (median) flight, `average` reads about 10 minutes long: 37% of route-days within 10 minutes, 65% within 15%. The other two methods read 11 minutes long, with 35 to 36% within 10 minutes and 60 to 62% within 15%. About half of the gap is the estimate aiming at the average flight, which late flights pull above the typical one: against the day's average flight the median error is about +4.6 minutes, and 40% are within 10 minutes. The owner decided "the average flight, bad days included" is the right thing to plan around.
- **Coverage:** in November 2024, 249 of 5,331 routes (3,687 flights) had no record in the newest month and would have used typical figures. Across the 36 months, 0.37% of flights were on routes with no past record of the month (mostly new routes), which start from their newest month and are off by about 17 minutes.

A second check, on years not used to choose the method: flight history was built back to January 2012 (local and uncommitted, 166 months in all) and the unchanged engine was run on 2017 to 2019 and 2022 (48 more reports). `average` was best again in each of those four years, at 3 and 6 months ahead. Average delay off by per route, in minutes, 3 months ahead:

| Years | `average` | `last-year` | `newest` |
| --- | ---: | ---: | ---: |
| 2017 to 2019 | 6.3 | 8.0 | 8.7 |
| 2022 | 7.4 | 10.3 | 9.6 |
| 2023 to 2025 (the first run) | 7.5 | 9.5 | 11.2 |

- **The optimistic lean depends on the era.** `average`'s bias was +0.05 minutes in 2017 to 2019, when delays were steady, and -2.8 in 2022 and -2.1 in 2023 to 2025, as delays rose after the pandemic. A straight average runs low whenever delays are rising.
- **Two cautions.** Route counts jump in January 2018, so rows from before then may not describe quite the same set of flights as rows after; the 2018 and 2019 estimates straddle the change, and `average` still won. And the 2022 estimates average in 2021, a pandemic-recovery year.

## How the gas-prices job was checked

Run on the week of 2026-10-26 (and 2026-10-19), against EIA's live bulk file (about 56 MB, cached in `.cache/gas-prices/` and fetched again after 12 hours):

- **Every price recomputed independently** with separate Python code: nine of nine regions match EIA's series exactly, and so do the week-before and year-earlier comparisons in the pull request summary.
- **Same bytes on a second run.** The EIA copy changes daily, but a past week's prices don't.
- **No key.** EIA's own weekly page offers only an old binary spreadsheet (`.xls`), and its API needs a key. The bulk file (`eia.gov/opendata/bulk/PET.zip`, JSON lines) needs neither, and has every region the engine uses. `west-coast` is EIA's "West Coast except California" series, because the engine puts California in its own region (`california`) and Arizona, Nevada, Oregon, and Washington in `west-coast`.
- **Bad input is refused:** a Tuesday, or any date EIA has no price for, writes nothing and says why.

## How the per-diem job was checked

Run on FY2027 (October 2026 to September 2027), against GSA's live files:

- **Every row rebuilt independently.** Separate Python code read GSA's ZIP-code spreadsheet and the meals breakdown and rebuilt all 42,358 rows (ZIP, destination, name, county, state, 12 months of lodging in calendar order, meals, lunch). Zero rows differ.
- **Cross-checked against GSA's other file.** The per-destination rates file (a different spreadsheet) agrees on lodging and meals for all 146 destinations that have one flat rate all year.
- **Same bytes on a second run.**
- **A ZIP code can appear twice.** 1,839 of the 40,426 ZIP codes span two counties with different rates (01011 is $157 a night under Northampton and $131 under Springfield; the median gap is about $25), so both rows are kept, as GSA lists them. Which one to use for a trip is the app's call and is an open question in the plan.
- **GSA's files change.** The file names carry validation dates, so the job reads the files page for its links. FY2026's header spells `Zip` where FY2027's says `ZIP` (the job ignores case), and FY2026 has 13 rows with a blank State (01470, 57716, 90233 and others). The job refuses that file and names the rows rather than guessing; FY2026 is not needed, so it is not built.
- **Lodging runs from $113 (the standard rate) to $499 (Park City, in January).** Lunch comes from GSA's meals breakdown: $19, $20, $22, $23, or $26 for the five meals rates ($68 to $92).
