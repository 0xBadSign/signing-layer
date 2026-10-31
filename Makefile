NODE ?= node

.PHONY: fetch rebuild test

# Network step: incremental and resumable (cached files are skipped). Takes about 2 hours from scratch.
fetch:
	$(NODE) scripts/fetch.mjs --sample-step 1

# Offline step: reads only data/raw, rewrites data/derived.
rebuild:
	$(NODE) scripts/build.mjs

test:
	$(NODE) --test test/*.test.mjs
