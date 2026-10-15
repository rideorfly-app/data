# Ride or Fly data

The public data behind [Ride or Fly](https://rideorfly.app), a tool that helps people decide whether to drive or fly for a one-way trip in the US.

Public numbers from public sources, checked every day and published only after a human signs off.

**Status:** in development. Nothing is published yet.

## What's here

| Dataset | Source | Updated |
| --- | --- | --- |
| Flight history: delays, cancellations, and scheduled flight times by route, airport, and nationwide | DOT on-time records | Monthly, about two months behind |
| Accuracy report: how close the engine's flight-time estimates came to the flights that actually flew | DOT records and the published engine | Monthly |
| Gas prices by region | EIA | Weekly |
| Hotel and meal rates | GSA per diem | Yearly |
| Road safety by state | NHTSA | Yearly |
| Winter passes on major highways | USGS and Census | Yearly |
| Airports | FAA commercial-service list | Yearly |
| Places and ZIP codes | Census | Yearly |
| Rental rates by region | A hand-kept table (estimates) | A few times a year |
| Airport parking | A hand-kept table (estimates) | Yearly |

## How it works

1. **Checked daily.** A workflow checks each source every day. When one has new data, it processes it and opens a pull request with the new files, one pull request per update.
2. **Reviewed by a person.** Each pull request is reviewed and merged by hand.
3. **Released by hand.** Each release is named for its date, such as `2026-10-14`, and comes with a manifest listing every file and its checksum. Releases are immutable, so a release's files can never change. Mistakes are fixed in a later release, and the history shows both.

Anyone can rerun a script on the same source data and get the same file. The scoring engine that reads this data is in [`rideorfly-app/engine`](https://github.com/rideorfly-app/engine).

## Licenses

- **Scripts** (the code, workflows, and tests): Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
- **Data files** (everything the scripts produce, and the hand-kept tables): Creative Commons Attribution 4.0 International. See [LICENSE-DATA](LICENSE-DATA). You can reuse them, including commercially, as long as you credit Ride or Fly.
- **Sources:** the DOT, USGS, Census, NHTSA, GSA, and EIA data is in the public domain.

The licenses cover the code and data, not the brand. The "Ride or Fly" name and logo are trademarks and aren't licensed for reuse.
