# NEAR as a signing and settlement layer: real, early, thinly captured

**Position (long term, 3 to 5 years):** constructive on NEAR, for a reason that has little to do with NEAR as a chain people use directly. NEAR is turning into infrastructure that other chains use: an MPC network that signs transactions for other chains (Chain Signatures, contract `v1.signer`) and a settlement venue for cross-chain swaps (NEAR Intents, contract `intents.near`). That use is growing fast. Classic L1 activity is collapsing at the same time, and the share of the new activity that reaches NEAR holders is still small. The bet is that infrastructure demand keeps compounding and that the value-capture channel opened in February 2026 (Intents revenue funding NEAR buybacks) scales with it.

This is a thesis, not a verdict. Section 5 lists the measurements that would prove it wrong, with thresholds, and the dashboard recomputes them from public data on every rerun.

All numbers below come from `data/derived/` (built offline from `data/raw/` by `scripts/build.mjs`; every series in `metrics.json` names its raw file and method). Window: 2024-10-01 to 2026-10-30, the last complete UTC day at fetch time. "30-day average" means the 30 days ending 2026-10-30.

---

## 1. What has to be true

| # | Claim | Status in the data |
|---|---|---|
| A | Other chains' users and apps use NEAR's MPC network to sign, and that use broadens beyond a few callers | **Partly.** Signing grew 7x in a year. The cross-chain share of sign calls rose from about 28% to about 58% within 90 days, and the callers are getting more diverse. But total signing is down from its May peak, and a few callers dominate |
| B | NEAR Intents becomes a large, durable settlement venue | **Yes, so far.** $130M a day, up 134% in a year, a record month in September 2026 |
| C | Value reaches the NEAR token | **Weakly.** Intents revenue is now 11x NEAR's L1 fees and funds buybacks. Annualized, that is 0.44% of market cap. Issuance is not measured here |

A without B is a niche service. B without C is a business NEAR hosts but does not own. The thesis needs all three over time. Today A and B are measurable and growing, and C is the weak link.

---

## 2. Evidence

### 2.1 Signing layer (Chain Signatures, `v1.signer`)

| Metric (30-day average) | Value | 1 year earlier | Change |
|---|---|---|---|
| Transactions touching `v1.signer` per day | 29,556 | about 4,100 | **+615%** |
| Share of all NEAR transactions | 4.0% | about 0.1% | about 40x |
| Peak 30-day average | 64,367 (2026-05-16) | | now -54% from peak |

Source: `signer_txs`, `signer_share_of_near_txns` in `metrics.json`. FastNEAR transaction counts per exact UTC day window, with day boundaries found by binary search on block timestamps (`data/raw/fastnear/boundaries.json`). Blocks per day agree with Nearblocks to a median 0.06%.

A count of transactions touching the contract overstates user demand, because MPC nodes answer each request with their own transaction. So we decoded a sample: one fixed UTC hour (12:00-12:59) on every second day for the last 90 days, 45 hours and 83,503 transactions, every one accounted for (decoded count equals the provider's count for each hour).

| What the sample shows | Value |
|---|---|
| `sign` requests | 49.1% of calls |
| `respond` (MPC nodes delivering signatures) | 49.1% |
| `verify_foreign_transaction` (the MPC attesting that a transaction landed on another chain) | 336 calls, 0.4%: **live on mainnet** |
| MPC nodes responding in every sampled hour | 17 |
| Distinct contracts or accounts calling `sign` per sampled hour | median 14 (range 9-23). It rose from 12 in the first half of the sample to 17 in the second half |
| Distinct `sign` callers across the whole sample | 212 |
| Cross-chain share of sign calls (bridge and connector contracts) | **about 28% in early August 2026, 57.7% in the last 30 days of samples** (41.2% over the whole sample) |
| NEAR-native share (`fast-auth.near`) | about 59% in early August, 33.0% in the last 30 days (46.6% over the whole sample) |

So user-driven signing is about half of `signer_txs`: about 15,000 signature requests a day. The mix is moving toward other chains: bridge and connector contracts (`omni.bridge.near`, `btc-connector.bridge.near`, `zcash-connector.bridge.near`) went from a minority to a majority of sign calls within the sample. Per-day shares are in `data/derived/sample_callers.csv`. The callers are getting more diverse, and the new attestation call (proof that a foreign transaction landed) is already in production use. That call matters for the thesis: it makes NEAR a verifier of other chains, not only a signer for them.

### 2.2 Settlement layer (NEAR Intents)

| Metric (30-day average) | Value | 91 days earlier | 1 year earlier |
|---|---|---|---|
| Intents volume, USD/day | **$130.4M** | +86% | +134% |
| Intents gross fees, USD/day | $198k | +90% | +145% |
| Intents revenue captured by NEAR, USD/day | **$71.5k** | +337% | (near zero then) |
| `intents.near` transactions/day | 86,536 | +37% | -16% |

Monthly volume: $23M in March 2025, $484M in September 2025, $2.0-2.7B a month through the first half of 2026, then a record **$4.80B in September 2026**. October had $3.91B in 30 days. Sources: `intents_volume_usd`, `intents_fees_usd`, `intents_revenue_usd`, `intents_txs`. DefiLlama for USD and FastNEAR for transactions.

Volume grows while transaction counts do not. The average trade got larger, which fits a settlement venue used by solvers and integrators rather than a retail app.

### 2.3 Value capture

| Metric | Value |
|---|---|
| Intents revenue captured by NEAR, annualized (30-day average x 365) | $26.1M |
| NEAR L1 transaction fees, annualized | $2.35M |
| Intents revenue / L1 fees | **11.1x** |
| Market cap snapshot (Nearblocks, 2026-10-31) | $5.87B at $4.48 |
| Buyback funding as a share of market cap, annualized | **0.44%** |
| L1 fees as a share of market cap, annualized | 0.04% |

Source: `value_capture` in `metrics.json`. DefiLlama's methodology for `near-intents` states that since 2026-02-23 NEAR's captured Intents revenue buys NEAR on the open market (not burned). Monthly captured revenue went from $0.26M (April 2026) to $1.84M (September) and $2.15M (October).

The new layer already pays more than the old one, by an order of magnitude. That is the strongest single fact for the thesis. It is also small: 0.44% a year of market cap.

---

## 3. Counter-evidence

Each item argues against the thesis or limits it.

1. **Classic L1 use has collapsed.**
   - Daily active accounts: 996k in October 2024 (monthly mean of daily values), 72.9k now, **-73% in a year**.
   - Transactions: 8.3M a day at the January 2025 peak, 0.74M now, -84% in a year.
   - New accounts: 470k a day at the peak, 9,250 now, -96%.
   - Most of the 2026 drop happened in one day: NEAR transactions went from 3.76M on 2026-04-01 to 1.06M on 2026-04-02, while active accounts stayed at 131k-139k. That pattern fits one high-volume application stopping, or a change in how transactions are counted, more than users leaving. We did not identify the cause (UNVERIFIED).
   - If the thesis is right, this does not matter much. If it is wrong, this is what NEAR is left with.
2. **Signing peaked in May 2026 and is down 54% since.** Monthly `signer_txs`: 1.80M in May, 1.30M in September, 0.89M in October (30 days). Growth is not monotonic. The year-over-year figure flatters it, because the base is small.
3. **Much of signing is NEAR-native, not cross-chain.**
   - The largest `sign` caller over the whole sample is `fast-auth.near`, with 46.6% of sign calls (33.0% in the last 30 days). FastAuth uses the MPC network to hold keys for NEAR accounts (email login).
   - The Ed25519-type domain (domain 1, used for NEAR-style keys) carries 53.5% of sign calls.
   - Bridge and connector contracts are the clearly cross-chain share: `omni.bridge.near` 21.4%, `btc-connector.bridge.near` 13.0%, `zcash-connector.bridge.near` 6.9%, together **41.2%** over the whole sample.
   - The falling NEAR-native share and the falling total since May are consistent with FastAuth use shrinking while bridge use holds. Our sample covers only the last 90 days, so we cannot show that for May (UNVERIFIED).
   - A load-test account, `tx-bench.near`, accounts for 8.7%.
4. **Demand is concentrated.** Five callers make about 97% of sign calls (46.6 + 21.4 + 13.0 + 8.7 + 6.9). A median of 14 distinct callers per hour is a small customer base for "a layer".
5. **Value capture is small and political.**
   - 0.44% of market cap a year, before issuance. Staking issuance is not measured here; any issuance above 0.44% a year outweighs the buyback.
   - The buyback is a governance decision from February 2026, and it can be changed.
   - Most Intents fees go to solvers and front ends: NEAR captured 36% of gross fees in the last 30 days ($71.5k of $198k).
6. **Intents transactions are spiky and partly synthetic.** Single days run 3-5x above or below their neighbours (for example 365k-592k transactions on 2025-07-23 to 2025-07-25, and 5.4k on 2025-07-05). We did not separate bots from users.
7. **Fees on NEAR itself are tiny.** $6.4k a day in L1 fees. The chain's own fee market does not fund its security; the token's value rests on the new layer and on expectations.

---

## 4. Why the bet can still be right

- **The products are infrastructure, and infrastructure metrics look like this early on:** few, large customers (bridges, wallets, solvers), lumpy volume and growth in value per transaction rather than in transaction count. The rising number of distinct sign callers (12 to 17 per hour within the 90-day sample) is the leading indicator to watch, more than raw counts.
- **The attestation call is new and already used.** `verify_foreign_transaction` lets a NEAR contract act on proof that something happened on another chain, signed by the same MPC network that signs for it. That is a different role: NEAR as a verifier of other chains, not only a signer for them. It makes products possible that combine signing and verification. Our companion project Bridle (see below) is one example: a DAO vault that has the MPC sign Base transactions and releases funds only after the MPC attests that they landed.
- **Capture already beats the old model.** At 11x L1 fees, the buyback channel is a working mechanism, not a promise. The question is the rate, not the existence.

---

## 5. What would change my mind (signals, with thresholds)

Re-evaluate on **2027-04-30** with `make fetch && make rebuild` (the dashboard shows the current values). All values are 30-day averages unless stated. "Sustained" means 60 consecutive days.

| Id | Signal | Now (to 2026-10-30) | Strengthens the thesis | Weakens the thesis |
|---|---|---|---|---|
| S1 | `v1.signer` transactions/day | 29,556 | a new high above 64,367 | below 15,000, sustained |
| S2 | Distinct sign callers per sampled hour (median of the last 30 days of samples) | 18 | 30 or more | 10 or fewer |
| S3 | Cross-chain share of sign calls (bridge and connector contracts, last 30 days of samples) | 57.7% | 70% or more | 35% or less |
| S4 | Intents volume, USD/day | $130.4M | $250M or more | below $65M, sustained |
| S5 | NEAR L1 fees, USD/day | $6.4k | $20k or more | (context only) |
| S6 | Daily active accounts | 72.9k | (context only) | (context only, unless S1 and S4 also weaken) |
| S7 | Intents revenue captured by NEAR, USD/day | $71.5k | $150k or more (about 0.9% of today's market cap a year) | below $30k, sustained |

**The thesis is wrong if any of these holds:**
- S1 and S4 are both in the weakening zone: the layer is not growing;
- S7 weakens while S4 does not: volume grows but NEAR's share is cut;
- S3 falls back to 35% or less: Chain Signatures turns out to be mainly a NEAR wallet feature, not a layer for other chains.

---

## 6. Method and limits

- **Sources (all keyless and public):**
  - Nearblocks `/v1/charts` (daily L1 metrics) and `/v1/stats` (supply and market cap snapshot);
  - DefiLlama `near-intents` (volume, gross fees, captured revenue, TVL) and `near` (L1 fees, cross-check);
  - FastNEAR transaction API (daily counts per contract, transaction decoding for the sample).
- **Cross-checks:**
  - L1 fees from Nearblocks and DefiLlama agree to a median of 0.1% per day; the ratio of totals is 1.0016.
  - Blocks per day agree with Nearblocks to a median of 0.06%. Two days differ by more than 2%, both outage-like days that both providers show as low.
- **Limits:**
  - The destination chain of a signature is not visible on NEAR. We infer "cross-chain" only from the calling contract and the key domain.
  - The sample is one fixed UTC hour on every second day, so shares and distinct counts describe that hour and may carry time-of-day bias. The sampled hour holds a median 4.5% of a day's transactions, against 4.17% for a flat day.
  - Distinct callers per hour are lower bounds for daily counts.
  - USD figures are DefiLlama's definitions.
  - Intents data starts in December 2024 (volume) and May 2025 (fees and revenue), so year-over-year numbers for fees and revenue start from a small base.
  - Staking issuance and the actual buyback executions are not measured.
  - Raw sample transactions are trimmed to the fields used, with the sha256 of each full response kept (`data/raw/manifest.json`).
- **Reproduce:**
  - `make test` rebuilds `data/derived` from `data/raw` into a temporary directory and checks that it is byte-identical. No network is needed.
  - `make fetch` adds new days incrementally.

## Companion project

Bridle (NEAR HACKATHON, AI Security track) is a DAO vault that uses Chain Signatures and `verify_foreign_transaction` on testnet. It is built by the same author as an independent project. This thesis uses none of Bridle's data or claims.
