# NEAR as a signing and settlement layer: real, early, thinly captured

**Position (long term, 3 to 5 years):** constructive on NEAR, for a reason that has little to do with NEAR as a chain people use directly. NEAR is turning into infrastructure that other chains use: an MPC network that signs transactions for other chains (Chain Signatures, contract `v1.signer`) and a settlement venue for cross-chain swaps (NEAR Intents, contract `intents.near`). That use grew strongly over the past year: Intents volume +79% and `v1.signer` transactions 6.4x, comparing 30-day averages a year apart. The +79% depends on where the year-earlier window falls: it ends just before a November 2025 surge, and today's volume is only 7.6% above the highest 30-day average of that surge (section 2.2). The most recent 30 days were weaker than the 30 days before for most of these series (section 2.4). Classic L1 activity is collapsing at the same time, and the share of the new activity that reaches NEAR holders is still small. The bet is that infrastructure demand keeps compounding and that the value-capture channel opened in February 2026 (Intents revenue funding NEAR buybacks) scales with it.

This is a thesis, not a verdict. Section 5 lists the measurements that would prove it wrong, with thresholds, and the dashboard recomputes them from public data on every rerun.

All numbers below come from `data/derived/` (built offline from `data/raw/` by `scripts/build.mjs`; every series in `metrics.json` names its raw file and method). `node scripts/figures.mjs` prints every figure quoted here from those files, with the file and column it comes from. Window: 2024-10-01 to 2026-11-06, the last complete UTC day at fetch time. "30-day average" means the 30 days ending 2026-11-06 (2026-10-08 to 2026-11-06); "a year earlier" means the 30 days ending 364 days before that.

---

## 1. What has to be true

| # | Claim | Status in the data |
|---|---|---|
| A | Other chains' users and apps use NEAR's MPC network to sign, and that use broadens beyond a few callers | **Partly.** Signing grew 6.4x in a year. In the sampled hours, the cross-chain share of sign calls rose from 31.5% in August 2026 to 57.3% in October 2026, and the number of distinct callers per hour rose. The share rose because FastAuth calls fell; bridge and connector calls per sampled hour stayed about flat (section 2.1), so this is not yet broader use. Total signing is 54% below its May peak and 24% below the previous 30 days, and five callers make 96.6% of sign calls |
| B | NEAR Intents becomes a large, durable settlement venue | **Yes, so far.** $134.1M a day, up 79% in a year (but only 7.6% above the highest 30-day average of November 2025), with a record month in September 2026 ($4.80B). October was lower ($3.99B) |
| C | Value reaches the NEAR token | **Weakly.** Intents revenue is now 11.7x NEAR's L1 fees and funds buybacks. Annualized, that is 0.51% of market cap. Measured net supply growth was 2.48% over the last year, so the buyback at its current rate offsets about a fifth of it |

A without B is a niche service. B without C is a business NEAR hosts but does not own. The thesis needs all three over time. Today A and B are measurable and grew over the year, and C is the weak link.

---

## 2. Evidence

### 2.1 Signing layer (Chain Signatures, `v1.signer`)

| Metric (30-day average) | Value | 1 year earlier | Change |
|---|---|---|---|
| Transactions touching `v1.signer` per day | 29,515 | 4,624 | **+538% (6.4x)** |
| Share of all NEAR transactions | 4.4% | 0.10% | about 42x |
| Peak 30-day average | 64,367 (30 days ending 2026-05-16) | | now -54% from peak |

Source: `signer_txs`, `signer_share_of_near_txns` in `metrics.json`. FastNEAR transaction counts per exact UTC day window, with day boundaries found by binary search on block timestamps (`data/raw/fastnear/boundaries.json`). Blocks per day agree with Nearblocks to a median 0.06%.

A count of transactions touching the contract overstates user demand, because MPC nodes answer each request with their own transaction. So we decoded a sample: one fixed UTC hour (12:00-12:59) on 90 days between 2026-08-03 and 2026-11-06 (every day from 2026-08-09 to 2026-10-31, and every second day at both ends), 167,681 transactions, every one accounted for (decoded count equals the provider's count for each hour).

| What the sample shows | Value |
|---|---|
| `sign` requests | 49.0% of calls |
| `respond` (MPC nodes delivering signatures) | 49.1% |
| `verify_foreign_transaction` (the MPC attesting that a transaction landed on another chain) | 727 calls, 0.4%: **live on mainnet** |
| MPC nodes responding | 17 distinct across the sample; median 16 per sampled hour |
| Distinct contracts or accounts calling `sign` per sampled hour | median 14 (range 9-23). The median rose from 13 in the first half of the sample (2026-08-03 to 2026-09-19) to 16 in the second half (2026-09-20 to 2026-11-06) |
| Distinct `sign` callers across the whole sample | 368 |
| Cross-chain share of sign calls (bridge and connector contracts) | **31.5% in August 2026, 46.0% in September, 57.3% in October**; 31.8% in the first 30 days of the sample, 58.0% in the last 30 days; 43.7% over the whole sample |
| NEAR-native share (`fast-auth.near`) | 55.8% in August, 41.4% in September, 33.8% in October; 55.4% in the first 30 days, 32.7% in the last 30 days; 44.7% over the whole sample |

Each share is a ratio of sums: sign calls by that class of caller over all sign calls, across every sampled hour in the period (26 sampled days in August, 30 in September, 31 in October, 27 in each 30-day window). Per-day counts are in `data/derived/sample_callers.csv`.

So user-driven signing is about half of `signer_txs`: about 14,500 signature requests a day. The mix moved toward other chains: bridge and connector contracts (`omni.bridge.near`, `btc-connector.bridge.near`, `zcash-connector.bridge.near`) went from about a third to a majority of sign calls within the sample. That is a share effect, not growth in bridge use: bridge and connector sign calls per sampled hour were about flat (367 in the first 30 days of the sample, 376 in the last 30; 364 in August, 456 in September, 385 in October), while `fast-auth.near` calls fell from 638 to 212 per hour and all sign calls from 1,152 to 649. The callers are getting more diverse, and the new attestation call (proof that a foreign transaction landed) is already in production use. That call matters for the thesis: it makes NEAR a verifier of other chains, not only a signer for them.

### 2.2 Settlement layer (NEAR Intents)

| Metric (30-day average) | Value | vs 91 days earlier | vs 1 year earlier |
|---|---|---|---|
| Intents volume, USD/day | **$134.1M** | +99% | +79% |
| Intents gross fees, USD/day | $205k | +123% | +68% |
| Intents revenue captured by NEAR, USD/day | **$67.2k** | +329% | not meaningful: the year-earlier average ($14.1k) comes from one day, 2025-11-07 ($423k), one of the four anomalous days in section 6; the other 29 days are $0 |
| `intents.near` transactions/day | 102,770 | +56% | -1% |

Monthly volume: $23.5M in March 2025, $484M in September 2025, $1.72B in October 2025, **$3.66B in November 2025** ($122M a day), $2.01B in December 2025, between $1.90B (April) and $2.72B (January) a month from January to June 2026, $2.78B in August 2026, then a record **$4.80B in September 2026** and $3.99B in October. November 2025 was larger than every month from December 2025 to August 2026. The +79% year over year is sensitive to that: the year-earlier window (30 days ending 2025-11-07, $74.9M a day) ends during the November 2025 ramp. The 30-day average then reached $124.6M (30 days ending 2025-11-28); today's $134.1M is 7.6% above that level. Sources: `intents_volume_usd`, `intents_fees_usd`, `intents_revenue_usd`, `intents_txs`; monthly sums in `monthly.csv`. DefiLlama for USD and FastNEAR for transactions.

Over a year, volume grew while transaction counts did not: 30-day volume is up 79% and `intents.near` transactions are down 1% (2026-Q3 against 2025-Q3: volume +831%, transactions -3%). Volume per transaction went from $723 to $1,305 (30-day averages). Over shorter windows this does not hold: in the last 91 days both grew (volume +99%, transactions +56%), and in the last 30 days volume fell 11.6% while transactions rose 16.5%. The year-over-year pattern, a larger average trade, fits a settlement venue used by solvers and integrators rather than a retail app.

### 2.3 Value capture

| Metric | Value |
|---|---|
| Intents revenue captured by NEAR, annualized (30-day average x 365) | $24.5M |
| NEAR L1 transaction fees, annualized | $2.10M |
| Intents revenue / L1 fees | **11.7x** |
| Market cap snapshot (Nearblocks `/v1/stats`, fetched 2026-11-07 23:31 UTC) | $4.85B at $3.70 |
| Buyback funding as a share of market cap, annualized | **0.51%** |
| L1 fees as a share of market cap, annualized | 0.04% |
| Net supply growth, 2025-11-07 to 2026-11-07 (total supply in block headers) | **+2.48%** (+31.7M NEAR, $117M at $3.70) |
| Annualized buyback funding / value of that net new supply | **0.21** |

Source: `value_capture` and `net_supply_growth` in `metrics.json`. DefiLlama's methodology for `near-intents` states that since 2026-02-23 NEAR's captured Intents revenue buys NEAR on the open market (not burned); "buyback funding" in this document is that captured revenue, not measured buyback executions (section 6). Monthly captured revenue was between $0.18M (December 2025) and $0.72M (August 2026) a month from December 2025 to August 2026 (November 2025, $0.77M, includes the anomalous 2025-11-07, section 6), then $1.84M in September and $2.19M in October 2026. The market cap is Nearblocks' `market_cap`, which equals about total supply times price (close to fully diluted); on circulating supply (1,249.8M NEAR) it would be $4.62B and the buyback share 0.53%. The L1 fee 30-day average ($5.7k a day) is lifted by a few spike days; the median day of the last 30 was $4.0k. Net supply growth is the change in `total_supply` between the first blocks of 2025-11-07 and 2026-11-07 (heights 171,546,781 and 223,387,847, from a NEAR archival RPC): 1,279.3M to 1,311.0M NEAR. It is net of burnt fees, so it is slightly below gross issuance.

The new layer already pays more than the old one, by an order of magnitude. That is the strongest single fact for the thesis. It is also small: 0.51% of market cap a year, against 2.48% net supply growth a year.

### 2.4 Recent momentum

The last 30 days (to 2026-11-06) were weaker than the 30 days before for most series, and the dashboard tiles show this as negative month-over-month changes: `v1.signer` transactions -23.8%, Intents volume -11.6%, Intents gross fees -20.1%. Captured revenue was flat on the month (+2.4%) but 18.3% below its 30-day peak ($82.2k, 30 days ending 2026-10-16), and `intents.near` transactions rose 16.5%. By calendar month, Intents volume fell from the September record ($4.80B, $160M a day) to $3.99B in October ($129M a day); the first six days of November averaged $132M a day. Captured revenue still rose from $1.84M in September to $2.19M in October, because NEAR's capture rate rose: 5.0 basis points of volume in the last 30 days against 3.1 in 2026-Q3. The year-over-year growth above is real, but one weaker month does not show whether 2026-Q3 was a new level or a peak. The signals in section 5 are built to tell the difference.

---

## 3. Counter-evidence

Each item argues against the thesis or limits it.

1. **Classic L1 use has collapsed.**
   - Daily active accounts: 996.9k in October 2024 and 72.0k in October 2026 (monthly means of daily values, -93% over two years). The 30-day average is 56.9k, against 265.6k for the 30 days ending a year earlier (**-79% in a year**).
   - Transactions: the highest 30-day average was 8.30M a day (30 days ending 2025-01-01); the 30-day average now is 0.67M, -85% in a year and -92% from that peak.
   - New accounts: the highest 30-day average was 469.7k a day (30 days ending 2025-01-02); now 9,704, -96% in a year and -98% from that peak.
   - Most of the 2026 drop in transactions happened in one day: NEAR transactions went from 3.76M on 2026-04-01 to 1.06M on 2026-04-02, while active accounts stayed at 132k-139k. That pattern fits one high-volume application stopping, or a change in how transactions are counted, more than users leaving. We did not identify the cause (UNVERIFIED).
   - If the thesis is right, this does not matter much. If it is wrong, this is what NEAR is left with.
2. **Signing peaked in May 2026 and is down 54% since.** Monthly `signer_txs`: 1.80M in May, 1.30M in September, 0.91M in October. Growth is not monotonic. The year-over-year figure flatters it, because the base is small.
3. **Much of signing is NEAR-native, not cross-chain.**
   - The largest `sign` caller over the whole sample is `fast-auth.near`, with 44.7% of sign calls (32.7% in the last 30 days). FastAuth uses the MPC network to hold keys for NEAR accounts (email login).
   - The Ed25519-type domain (domain 1, used for NEAR-style keys) carries 51.2% of sign calls.
   - Bridge and connector contracts are the clearly cross-chain share: `omni.bridge.near` 22.0%, `btc-connector.bridge.near` 12.8%, `zcash-connector.bridge.near` 8.9%, together **43.7%** over the whole sample.
   - The falling NEAR-native share and the falling total since May are consistent with FastAuth use shrinking while bridge use holds. Our sample starts in August 2026, so we cannot show that for May (UNVERIFIED).
   - A load-test account, `tx-bench.near`, accounts for 8.2%.
4. **Demand is concentrated.** Five callers make 96.6% of sign calls (44.7 + 22.0 + 12.8 + 8.9 + 8.2). A median of 14 distinct callers per hour is a small customer base for "a layer".
5. **Value capture is small and political.**
   - 0.51% of market cap a year, against measured net supply growth of 2.48% a year (section 2.3). At today's rate the buyback absorbs about a fifth of the value of net new supply.
   - The buyback is a governance decision from February 2026, and it can be changed.
   - Most Intents fees go to solvers and front ends: NEAR captured 33% of gross fees in the last 30 days ($67.2k of $205k).
6. **Intents transactions are spiky and partly synthetic.** Single days run several times, up to about 24x, above or below their neighbours (for example 15.0k transactions on 2025-07-22, then 366k-592k on 2025-07-23 to 2025-07-25 and 108k on 2025-07-26; and 5.4k on 2025-07-05 between 34.0k and 35.5k). We did not separate bots from users.
7. **Fees on NEAR itself are tiny.** $5.7k a day in L1 fees (30-day average). The chain's own fee market does not fund its security; the token's value rests on the new layer and on expectations.

---

## 4. Why the bet can still be right

- **The products are infrastructure, and infrastructure metrics look like this early on:** few, large customers (bridges, wallets, solvers), lumpy volume and growth in value per transaction rather than in transaction count. The rising number of distinct sign callers (median 13 to 16 per hour between the two halves of the sample) is the leading indicator to watch, more than raw counts.
- **The attestation call is new and already used.** `verify_foreign_transaction` lets a NEAR contract act on proof that something happened on another chain, signed by the same MPC network that signs for it. That is a different role: NEAR as a verifier of other chains, not only a signer for them. It makes products possible that combine signing and verification. Our companion project Bridle (see below) is one example: a DAO vault that has the MPC sign Base transactions and releases funds only after the MPC attests that they landed.
- **Capture already beats the old model.** At 11.7x L1 fees, the buyback channel is a working mechanism, not a promise. The question is the rate, not the existence.

---

## Scenarios

Horizon: the next 12 months (2026-11-07 to 2027-11-06). These scenarios are not forecasts and contain no price target. They show what captured revenue each volume path implies and how it compares with dilution.

**Data (measured, see section 2.3):** Intents volume $134.1M a day (30-day average); NEAR's capture rate 5.0 basis points of volume over the last 30 days and 3.1 in 2026-Q3 (by calendar month: 1.3 to 3.1 bp from January to August 2026, median 2.6 bp, then 3.8 in September and 5.5 in October, the highest month, so the 5 bp in Base and Bull assumes the recent record rate holds); market cap $4.85B at $3.70 (2026-11-07); net supply growth 2.48% over the last year, 31.7M NEAR, worth $117M at $3.70.

**Assumptions (round numbers chosen by the author, not data):** the 12-month average volume and capture rate in each row, the market cap staying at the snapshot, and net supply growth staying at the last year's rate.

| Scenario (assumptions) | Volume, USD/day | NEAR capture | Captured revenue (buyback funding) | Per year | Share of market cap | Share of net new supply value |
|---|---|---|---|---|---|---|
| Bear | $50M | 3 bp | $15k/day | $5.5M | 0.11% | 0.05 |
| Base | $130M | 5 bp | $65k/day | $23.7M | 0.49% | 0.20 |
| Bull | $300M | 5 bp | $150k/day | $54.8M | 1.13% | 0.47 |

- **Bear:** volume falls below the S4 weakening line ($65M a day), and below the weakest month of 2026 so far (April, $63M a day), and NEAR's capture falls back to the 2026-Q3 rate, for example after a governance change.
- **Base:** volume and capture stay at about the last 30 days.
- **Bull:** volume of $300M a day, about 1.9x the September 2026 record pace and above the S4 strengthening line ($250M a day), at today's capture rate. Captured revenue then equals the S7 strengthening line ($150k a day).

**When the buyback matters against issuance.** At $3.70, offsetting all of the measured net new supply takes about $322k a day of captured revenue: 4.8x the last 30 days, or about $640M a day of volume at 5 bp. This thesis counts the buyback as material once it offsets at least half of net new supply, about $161k a day at the snapshot price. Even the bull case only gets close (0.47). The ratio depends on price: the buyback is in USD and issuance is in NEAR, so at half the price the same revenue buys twice as many tokens (the base case would then offset 0.40). Issuance is mostly paid to stakers, so it dilutes holders who do not stake. The comparison is about net token supply, not about staking returns.

---

## 5. What would change my mind (signals, with thresholds)

Re-evaluate on **2027-04-30** with `make fetch && make rebuild` (the dashboard shows the current values). All values are 30-day averages unless stated. "Sustained" means 60 consecutive days.

| Id | Signal | Now (to 2026-11-06) | Strengthens the thesis | Weakens the thesis |
|---|---|---|---|---|
| S1 | `v1.signer` transactions/day | 29,515 | a new high above 64,367 | below 15,000, sustained |
| S2 | Distinct sign callers per sampled hour (median of the last 30 days of samples) | 17 | 30 or more | 10 or fewer |
| S3 | Cross-chain share of sign calls (bridge and connector contracts, last 30 days of samples) | 58.0% | 70% or more | 35% or less |
| S4 | Intents volume, USD/day | $134.1M | $250M or more | below $65M, sustained |
| S5 | NEAR L1 fees, USD/day | $5.7k | $20k or more | (context only) |
| S6 | Daily active accounts | 56.9k | (context only) | (context only, unless S1 and S4 also weaken) |
| S7 | Intents revenue captured by NEAR, USD/day | $67.2k | $150k or more (about 1.1% of the 2026-11-07 market cap a year) | below $30k, sustained |

**The thesis is wrong if any of these holds:**
- S1 and S4 are both in the weakening zone: the layer is not growing;
- S7 weakens while S4 does not: volume grows but NEAR's share is cut;
- S3 falls back to 35% or less: Chain Signatures turns out to be mainly a NEAR wallet feature, not a layer for other chains.

S3 is a share. It can reach its strengthening line only because NEAR-native (FastAuth) calls fall, with no growth in bridge calls; that is what happened between August and October 2026 (section 2.1). Read it together with the absolute bridge and connector sign calls per sampled hour, which `node scripts/figures.mjs` prints.

---

## 6. Method and limits

- **Sources (all keyless and public):**
  - Nearblocks `/v1/charts` (daily L1 metrics) and `/v1/stats` (supply and market cap snapshot);
  - DefiLlama `near-intents` (volume, gross fees, captured revenue, TVL) and `near` (L1 fees, cross-check);
  - FastNEAR transaction API (daily counts per contract, transaction decoding for the sample);
  - FastNEAR archival NEAR JSON-RPC, method `block` (total supply at two day boundaries a year apart).
- **Cross-checks:**
  - L1 fees from Nearblocks and DefiLlama agree in total (ratio of totals 1.0017) but not day by day: the median absolute daily difference is 2.95% (p90 8.42%, maximum 28.05%), and 17% of days are within 1%.
  - Blocks per day agree with Nearblocks to a median of 0.06%. Two days differ by more than 2% (2025-07-04 and 2026-10-14), both outage-like days that both providers show as low.
- **Limits:**
  - The destination chain of a signature is not visible on NEAR. We infer "cross-chain" only from the calling contract and the key domain.
  - The sample is one fixed UTC hour per sampled day, so shares and distinct counts describe that hour and may carry time-of-day bias. The sampled hour holds a median 4.5% of a day's transactions, against 4.17% for a flat day.
  - Distinct callers per hour are lower bounds for daily counts.
  - USD figures are DefiLlama's definitions. On 4 of the 546 days that have both values (2025-11-07, 2026-01-15, 2026-02-02 and 2026-03-27), DefiLlama's captured revenue is larger than its gross fees for the same day, by $459k in total. Timing differences between fee accrual and sweeps to NEAR's revenue wallets could explain it; we did not investigate. None of these days is in the last 90 days, but 2025-11-07 is the only day with captured revenue in the year-earlier window, which is why section 2.2 gives no year-over-year change for captured revenue.
  - DefiLlama revises recent days between fetches. For 2026-10-30, gross fees changed from $67,878 in the previous committed fetch to $387,696 in this one, and captured revenue from $77,602 to $75,590 (before the refresh that day had revenue above fees). Figures for the last days of the window may still change.
  - "Buyback funding" is DefiLlama's captured revenue (`dailyRevenue`), which its methodology says buys NEAR since 2026-02-23. DefiLlama also publishes a separate holders-revenue series ("NEAR Buyback") that was not fetched, so the buyback figures assume all captured revenue goes to the buyback and are upper bounds if any does not.
  - Intents data starts in December 2024 (volume) and May 2025 (fees and revenue), so year-over-year numbers for fees and revenue start from a small base.
  - Net supply growth is measured from two block headers. Gross issuance, the split between stakers and non-stakers, and the actual buyback executions (on-chain purchases) are not measured.
  - Raw sample transactions are trimmed to the fields used, with the sha256 of each full response kept (`data/raw/manifest.json`).
- **Reproduce:**
  - `make test` rebuilds `data/derived` from `data/raw` into a temporary directory and checks that it is byte-identical. No network is needed.
  - `node scripts/figures.mjs` prints every figure in this document from `data/derived`.
  - `make fetch` adds new days incrementally.

## Companion project

Bridle (NEAR HACKATHON, AI Security track) is a DAO vault that uses Chain Signatures and `verify_foreign_transaction` on testnet. It is built by the same author as an independent project. This thesis uses none of Bridle's data or claims.
