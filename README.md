# signing-layer: data pipeline for the NEAR signing and settlement layer thesis

Question: is NEAR becoming the signing and settlement layer for other chains (Chain Signatures MPC contract `v1.signer` plus NEAR Intents `intents.near`) while classic user activity on NEAR falls? This repo holds only data, code and tests. It makes no claims; the thesis text and dashboard live elsewhere.

Companion project: Bridle (link to be added)

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
| Method mix, callers, domains | FastNEAR `POST /v0/account` pages plus `POST /v0/transactions` on a stratified sample | See sample section |

Window: 2024-10-01 up to the last complete UTC day at fetch time (see `metrics.json` `window`). The partial day of the fetch is never used.

### Day windows (inclusive and exclusive)

For UTC day D, `B(D)` is the first block whose timestamp is >= D 00:00:00 UTC, found by a binary/interpolation search over block heights with `POST /v0/block` (a skipped height returns `{"block":null}` and the search walks forward to the next existing block; it only stops when the candidate block's `prev_block_height` equals the last known block before the boundary, so no block can be missed). The day is the **inclusive** height range `[B(D), B(D+1) - 1]`. The FastNEAR API treats `from_tx_block_height` and `to_tx_block_height` as inclusive on both ends (checked by querying single-block windows). Boundaries are cached in `data/raw/fastnear/boundaries.json` with the block timestamp and previous height. As a sanity check, blocks per day from the height span are compared with the Nearblocks `blocks` column; days differing by more than 2% are flagged in `metrics.json` (`blocks_per_day_check`).

### Stratified sample (method mix and callers)

Full per-transaction scans are out of reach with free rate limits (about 1,500 calls per day of data). Instead, for sampled days in the last 90 complete days, every transaction touching `v1.signer` between 12:00:00 and 12:59:59 UTC is paged (`resume_token`, 200 per page) and decoded (`/v0/transactions`, 20 hashes per call). This gives method names, signer ids, predecessor ids and `domain_id` from call arguments. Caveats, also written into `metrics.json`:

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

Without `make`: `node scripts/fetch.mjs --sample-step 1`, `node scripts/build.mjs`, `node --test test/*.test.mjs`. `fetch` skips cached files, so an interrupted run continues where it stopped; delete a raw file to refetch it, or pass `--refresh-static` for the five static files. `--only static|counts|sample`, `--sample-step N` and `--sample-days N` narrow a run.

Outputs in `data/derived`: `daily.csv`, `rolling30.csv`, `monthly.csv`, `quarterly.csv`, `sample_daily.csv`, `sample_method_mix.csv`, `sample_callers.csv`, `sample_domains.csv`, and `metrics.json` (each metric carries `source` and `method`; includes 30-day averages, MoM, change versus 91 days earlier, YoY, peak and gaps).

## Sources and rate limits

| Host | Endpoint | Limit observed and used |
|---|---|---|
| tx.main.fastnear.com | `/v0/account`, `/v0/block`, `/v0/transactions` | About 1.5 req/s requested; the host still returns 429 every 60 to 70 calls, so effective throughput was about 55 calls/min. 429 backoff 15 s, growing per retry |
| api.nearblocks.io | `/v1/charts` | One call. Limit about 5 req/min, enforced client-side at 1 call per 12.5 s |
| api.llama.fi | `summary/dexs/near-intents`, `summary/fees/near-intents`, `summary/fees/near`, `protocol/near-intents` | 1 call per 2 s, no throttling seen |

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
- The committed sample covers every second day of the last 90 complete days (45 days, 2026-08-03 to 2026-10-30) to stay within the time budget; `make fetch` uses `--sample-step 1` and fills the other days. One earlier sample run was interrupted and resumed; its operational log entry is missing from `fetch-stats.json`.

## Dashboard

A static page in `web/` (no framework, inline SVG charts) reads `data/derived` and `web/signals.json`. Open it locally with `node scripts/serve.mjs` from the repo root and visit `http://localhost:8765/web/`. `node scripts/build-site.mjs` copies `web/` and `data/derived/` into `site/` (git-ignored); `.github/workflows/pages.yml` runs it and deploys to GitHub Pages once the repo is public. Signal thresholds live in `web/signals.json` (all `null` until set).
