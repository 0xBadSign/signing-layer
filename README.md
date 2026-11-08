# signing-layer: NEAR as a signing and settlement layer for other chains

## Result

**Claim:** NEAR is gaining use as signing and settlement infrastructure for other chains while its classic L1 use falls, and only a small part of the new activity reaches the NEAR token.<br>
**Figures:** NEAR Intents volume $134.1M a day (30-day average to 2026-11-06, +79% year over year, but only +7.6% above the highest 30-day average of November 2025, because the year-earlier window ends just before that month's surge); NEAR's captured Intents revenue, which funds buybacks, is 0.51% of market cap a year (snapshot 2026-11-07), against measured net supply growth of 2.48% (2025-11-07 to 2026-11-07); daily active accounts -79% year over year (30-day averages to 2026-11-06).<br>
**Caveat:** the last 30 days were weaker than the 30 days before (Intents volume -11.6%, `v1.signer` transactions -23.8%), so the data does not yet show whether 2026-Q3 was a new level or a peak.

Question: is NEAR becoming the signing and settlement layer for other chains (Chain Signatures MPC contract `v1.signer` plus NEAR Intents `intents.near`) while classic user activity on NEAR falls? This repository holds the thesis, the dashboard, and the data pipeline with its raw data and tests.

**The thesis is in [THESIS.md](THESIS.md); the dashboard is in `web/` (see Dashboard below).** This repository is the Investment Thesis track entry.

Companion project: **Bridle** (AI Security track, same author, independent repository), a DAO vault on testnet that uses Chain Signatures and `verify_foreign_transaction`. This thesis uses none of Bridle's data or claims.

## What the data is

Everything comes from keyless public APIs. Every number in `data/derived` traces to a cached raw file under `data/raw`; `data/raw/manifest.json` lists each raw file with url, method, request body, fetch time (UTC) and sha256.

| Series (daily, UTC) | Source | Notes |
|---|---|---|
| `signer_txs`: transactions touching `v1.signer` | FastNEAR `POST /v0/account` `txs_count` over a block window | Includes MPC node `respond` calls and housekeeping, so it is an upper bound on user signature requests |
| `intents_txs`: transactions touching `intents.near` | same | Very spiky; see limitations |
| `intents_volume_usd`, `intents_fees_usd` | DefiLlama `summary/dexs/near-intents`, `summary/fees/near-intents` | Volume from 2024-12-10, fees from 2025-05-10 (earlier days are missing, not zero) |
| `near_fees_usd_nearblocks` / `_defillama` | Nearblocks `/v1/charts` `txn_fee_usd`; DefiLlama `summary/fees/near` | Two independent providers, cross-checked in `metrics.json` |
| `near_txns`, `active_accounts`, `new_accounts`, `near_price_usd`, `blocks_nearblocks` | Nearblocks `/v1/charts` | |
| `intents_tvl_usd` | DefiLlama `protocol/near-intents` | Only about one year of history |
| `net_supply_growth` (in `metrics.json`) | NEAR JSON-RPC `block` on `archival-rpc.mainnet.fastnear.com`, header `total_supply` | Two blocks: the first block of the day after the window end and of the day 365 days earlier (heights from `boundaries.json`). Net of burnt fees |
| Method mix, callers, domains | FastNEAR `POST /v0/account` pages plus `POST /v0/transactions` on a stratified sample | See sample section |

Window: 2024-10-01 up to the last complete UTC day at fetch time (see `metrics.json` `window`). The partial day of the fetch is never used.

### Day windows (inclusive and exclusive)

For UTC day D, `B(D)` is the first block whose timestamp is >= D 00:00:00 UTC, found by a binary/interpolation search over block heights with `POST /v0/block` (a skipped height returns `{"block":null}` and the search walks forward to the next existing block; it only stops when the candidate block's `prev_block_height` equals the last known block before the boundary, so no block can be missed). The day is the **inclusive** height range `[B(D), B(D+1) - 1]`. The FastNEAR API treats `from_tx_block_height` and `to_tx_block_height` as inclusive on both ends (checked by querying single-block windows). Boundaries are cached in `data/raw/fastnear/boundaries.json` with the block timestamp and previous height. As a sanity check, blocks per day from the height span are compared with the Nearblocks `blocks` column; days differing by more than 2% are flagged in `metrics.json` (`blocks_per_day_check`).

### Stratified sample (method mix and callers)

Full per-transaction scans are out of reach with free rate limits (about 1,500 calls per day of data). Instead, for sampled days in the last 90 complete days of a fetch run (`--sample-days`, default 90), every transaction touching `v1.signer` between 12:00:00 and 12:59:59 UTC is paged (`resume_token`, 200 per page) and decoded (`/v0/transactions`, 20 hashes per call). This gives method names, signer ids, predecessor ids and `domain_id` from call arguments. The committed sample combines two runs and spans 96 calendar days, 2026-08-03 to 2026-11-06 (see Known limitations). Caveats, also written into `metrics.json`:

- It is one fixed hour per day, not a random sample of the day. Shares describe that hour and can be biased by time-of-day patterns and single large callers.
- Distinct callers per sampled hour are lower bounds for per-day numbers. Do not scale them or compare them with all-time counts.
- A transaction is classified by the first receipt addressed to `v1.signer` whose predecessor is not `v1.signer` (callbacks ignored). Wrapper methods such as `sign_transfer` and `sign_btc_transaction` are shown separately as `tx_entry_method`.
- The raw transaction files are trimmed (`trimTx` in `scripts/lib/fastnear.mjs`): the full responses are about 6 KB per transaction. Kept are the signer, receiver, outcome status, tx-level method names, and every receipt addressed to `v1.signer` with predecessor, method and the original base64 args. The sha256 of each full original response is stored in the file.

## How to rerun

Node 22 or newer, no dependencies, no API keys.

```
make fetch     # network; incremental and resumable; about 2-3 hours from scratch
make rebuild   # offline; rewrites data/derived from data/raw
make test      # node --test; rebuilds into a temp dir and compares byte-for-byte
```

Without `make` (it is optional, and not usually installed on Windows; every target is a plain `node` command): `node scripts/fetch.mjs --sample-step 1`, `node scripts/build.mjs`, `node --test test/*.test.mjs`. `fetch` skips cached files, so an interrupted run continues where it stopped; delete a raw file to refetch it, or pass `--refresh-static` for the seven static files. `--only static|counts|supply|sample`, `--sample-step N` and `--sample-days N` narrow a run.

Outputs in `data/derived`: `daily.csv`, `rolling30.csv`, `monthly.csv`, `quarterly.csv`, `sample_daily.csv`, `sample_method_mix.csv`, `sample_callers.csv`, `sample_domains.csv`, and `metrics.json` (each metric carries `source` and `method`; includes 30-day averages, MoM, change versus 91 days earlier, YoY, peak and gaps, the value-capture ratios and net supply growth).

`node scripts/figures.mjs` (offline) prints every figure quoted in THESIS.md, the README result and the video captions, computed from `data/derived`, each with the file, column or `metrics.json` key it comes from. Use it to check any number in the text.

## Sources and rate limits

| Host | Endpoint | Limit observed and used |
|---|---|---|
| tx.main.fastnear.com | `/v0/account`, `/v0/block`, `/v0/transactions` | About 1.5 req/s requested; the host still returned 429 about once every 32 calls in the 2026-10-31 runs (effective throughput about 54 calls/min) and once every 18 calls in the 2026-11-07 run (5,415 calls, 304 429s, about 39 calls/min). 429 backoff 15 s, growing per retry |
| api.nearblocks.io | `/v1/charts`, `/v1/stats` | One call each. Limit about 5 req/min, enforced client-side at 1 call per 12.5 s |
| api.llama.fi | `summary/dexs/near-intents`, `summary/fees/near-intents` (also with `dataType=dailyRevenue`), `summary/fees/near`, `protocol/near-intents` | 1 call per 2 s, no throttling seen |
| archival-rpc.mainnet.fastnear.com | NEAR JSON-RPC `block` by height | Two calls per run (cached afterwards), 1 call per 2 s |

The operational log of fetch runs (call counts, 429s, wall time) is in `data/raw/fetch-stats.json`.

## Known limitations

- `signer_txs` is transactions touching `v1.signer`, not user signature requests; node `respond` calls and housekeeping are included. Use the sample method mix to read the split, and remember it is one hour per day.
- `intents_txs` is highly volatile (single days several times above or below the neighbours). Causes were not investigated (bot or batch activity cannot be ruled out); treat transaction counts as weaker evidence than DefiLlama volume.
- DefiLlama volume and fee definitions (what counts as an Intents swap, gross versus net fees) are the provider's; they are not re-derived here.
- Nearblocks `multichain_txns` is zero on every row and is not used. No keyless source gives the destination chain of a signature; only `domain_id` and the calling contract are visible.
- Intents TVL history is only about one year.
- Block-count differences above 2% between FastNEAR and Nearblocks occur on a few days where both providers show a dip in blocks; see `metrics.json`.
- Nearblocks and DefiLlama NEAR fees agree closely in total, but not day by day; the disagreement is recorded in `metrics.json` (`near_fees_cross_check`).
- Whether `verify_foreign_transaction` is live on mainnet is read only from the sample (`verify_foreign_transaction_occurrences`); zero in the sample is not proof of absence.
- Explorer APIs that need tokens (NEAR Intents explorer, Pikespeak, Dune) were not used.
- The committed sample has 90 sampled days from 2026-08-03 to 2026-11-06: every day from 2026-08-09 to 2026-10-31 (84 days), plus every second day at both ends (2026-08-03, 2026-08-05, 2026-08-07 and 2026-11-02, 2026-11-04, 2026-11-06). It comes from two `--sample-step 2` runs whose day grids are offset by one day (the first counted back from 2026-10-30, the second from 2026-11-06); `make fetch` uses `--sample-step 1` and fills the remaining days. One earlier sample run was interrupted and resumed; its operational log entry is missing from `fetch-stats.json`.
- On 4 of the 546 days with both values (2025-11-07, 2026-01-15, 2026-02-02, 2026-03-27), DefiLlama's `intents_revenue_usd` is larger than `intents_fees_usd` for the same day (revenue exceeds fees by $459k in total over those days). The cause (for example timing of sweeps to NEAR's revenue wallets) was not investigated; none of these days is in the last 90 days, but 2025-11-07 is the only day with captured revenue in the year-earlier window, so the year-over-year change of captured revenue is not meaningful. `node scripts/figures.mjs` recounts them.
- DefiLlama revises recent days between fetches: for 2026-10-30, gross fees changed from $67,878 in the previous committed fetch to $387,696 in this one, and captured revenue from $77,602 to $75,590. Figures for the last days of the window may still change.
- "Buyback funding" is DefiLlama's captured revenue (`dailyRevenue`), which its methodology says buys NEAR since 2026-02-23. Its separate holders-revenue series ("NEAR Buyback") was not fetched, so buyback figures assume all captured revenue goes to the buyback. The market cap is Nearblocks' `market_cap`, about total supply times price (close to fully diluted).
- Net supply growth is measured from two block headers, so it is net of burnt fees. Gross issuance, the staker share and the buyback executions themselves are not measured.

## Dashboard

A static page in `web/` (no framework, inline SVG charts) reads `data/derived` and `web/signals.json`. Open it locally with `node scripts/serve.mjs` from the repo root and visit `http://localhost:8765/web/`. `node scripts/build-site.mjs` copies `web/` and `data/derived/` into `site/` (git-ignored); `.github/workflows/pages.yml` runs it and deploys to GitHub Pages once the repo is public. Signal thresholds live in `web/signals.json` and match section 5 of THESIS.md; the page marks each signal as strengthening, weakening, between thresholds or context only.

## NEAR HACKATHON

Built for NEAR HACKATHON, Investment Thesis track.

- Timing: the code and the analysis were written starting 2026-10-31, after the 2026-10-19 announcement (rule Q-001: code counts from the announcement date). There is no pre-hackathon code in this repository.
- AI assistance: development used AI coding agents (Claude Code).
- Libraries: none. The pipeline, tests, dashboard and server use only the Node 22 standard library (`node:*` modules); there is no `package.json` and no dependency to install. The optional demo-video pipeline in `video/` calls external programs (Google Chrome, ffmpeg), which are tools, not libraries.
- Data sources: keyless public APIs only (FastNEAR, Nearblocks, DefiLlama). The track's suggested BigQuery and Intents Explorer sources were not used because they need accounts or keys; the suggested sources are hints, not requirements (rule Q-011).
- Provenance: first commit `d847109` on 2026-10-31 (`git log` is the authority); the submitted state is tagged at submission.

## License

Code (`scripts/`, `web/`, `test/`, `video/`) is MIT, see [LICENSE](LICENSE). `THESIS.md` and the derived data in `data/derived/` are CC BY 4.0, see [LICENSE-DATA.md](LICENSE-DATA.md). Raw responses in `data/raw/` belong to their providers (FastNEAR, Nearblocks, DefiLlama) and are kept only so the build can be reproduced offline.
