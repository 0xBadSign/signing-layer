# Submission material (drafts for the owner)

Nothing here is sent or posted by the agent. The owner records or reviews the video, posts on X and confirms the payload. The video is `video/out/signing-layer-75s.mp4` (rebuild with `node video/make.mjs` after the data refresh).

Numbers are deliberately left out of the X draft and the idea text below, because the data is refreshed before submission. The video and the dashboard carry the current numbers; re-check any figure against `THESIS.md` and `data/derived/metrics.json` before quoting it.

## Project name
signing-layer

## Track
`thesis` (Investment Thesis)

## "What they built" (max 2000 characters)

signing-layer is an investment thesis on NEAR, a live dashboard and a reproducible data pipeline.

The question: is NEAR becoming the signing and settlement layer for other chains, while classic user activity on NEAR falls? Signing means the Chain Signatures MPC contract `v1.signer`. Settlement means NEAR Intents, `intents.near`.

The position: constructive over 3 to 5 years, as a bet on NEAR as infrastructure that other chains use. It is stated as a thesis, not a verdict, and it names what would prove it wrong.

What is in the repository:
- THESIS.md: the claims that must hold (broad use of signing, a durable settlement venue, value reaching the NEAR token), the evidence for each, the counter-evidence with the same weight, and the signals that would change the author's mind, each with a threshold.
- A dashboard that recomputes those signals from public data. Every chart shows its source: the API endpoint and the derived file and column it is drawn from.
- A pipeline from keyless public APIs (FastNEAR, Nearblocks, DefiLlama) to derived CSV and JSON. Every number traces to a cached raw file with url, request, fetch time and sha256. `make test` rebuilds offline into a temp dir and compares byte for byte.

Honesty about the data: transactions touching `v1.signer` include MPC node responses, so a decoded sample of one fixed UTC hour per sampled day is used to split user requests from node answers, with its bias written down. DefiLlama definitions are the provider's. The track's suggested BigQuery and Intents Explorer sources were not used because they need accounts or keys.

Built at NEAR HACKATHON with AI coding agents (Claude Code); Node 22 standard library only, no dependencies. Companion project: Bridle (independent).

## Video

`video/out/signing-layer-75s.mp4`, a captioned walk-through of the dashboard. The script is in `video/voiceover.md`. It was generated before the data refresh, so re-render it (`node video/make.mjs`) and check the spoken numbers against the refreshed data before posting.

## X post draft (the owner posts it)

Built at NEAR HACKATHON: signing-layer, an investment thesis on NEAR as the signing and settlement layer for other chains.

- Chain Signatures and NEAR Intents measured from public APIs
- the counter-evidence shown with the same weight as the evidence
- signals with thresholds that would prove the thesis wrong
- every chart names its source endpoint and derived file

@NEARProtocol #NEARHackathon

[video attached] [repo link]

## Submission payload checklist (owner supplies every value)
- projectName: "signing-layer"
- leadName: owner
- email: owner
- size: owner (team size)
- tracks: ["thesis"]
- nearAddress: owner's mainnet account
- projectUrl: public repo URL (owner)
- demoUrl: the X post URL (owner)
- idea: the text above (between 20 and 2000 characters; check the length after any edit)
- consent: only after the owner reads and agrees to the notice
