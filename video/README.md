# Demo video pipeline

Turns the dashboard in `web/` into a finished MP4 with burned-in captions. No npm dependencies, nothing downloaded.

```
node video/make.mjs    # capture every scene, render the cut, write video/voiceover.md
```

Requirements: Node 22, Google Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`, override with `CHROME_PATH`), ffmpeg and ffprobe on PATH (or `FFMPEG_DIR`). The dashboard reads only the local files in `data/derived`, so no network is needed.

## What it does

- `capture.mjs` serves the repository root on port 8782, launches headless Chrome through the DevTools Protocol (port 9332, page laid out at 1280x720 CSS px with device scale 1.5, so frames are 1920x1080), plays each scene of `shots.json` and writes frames plus `timeline.json` to `video/work/<scene>/`. It waits for the real charts and tables to be drawn.
- `render.mjs` slices the timelines into the cut defined in `shots.json`, writes an ASS caption file and runs ffmpeg (1920x1080, 30 fps, H.264, yuv420p, no audio). It also writes `voiceover.md` (the caption lines with start times).
- Output: `video/out/signing-layer-75s.mp4`. `video/out/` and `video/work/` are gitignored.

## Editing

`shots.json` has `scenes` (what to capture) and `cuts` (which slice of which scene, with which caption). Scene steps: `hold`, `scroll`, `type`, `click`, `mark` / `unmark` (red highlight ring), `hash`, `select`, `waitFor`, `sleep`, `eval`. A scene with `card` renders a title card from `card.mjs`. Captions are a string or a list of `{ at, text, pos }` (seconds into the entry).

Recapture only some scenes: `node video/capture.mjs --scene signing,capture`, then `node video/render.mjs`.

## After new data

After `make fetch && make rebuild` the numbers in the captions (29,556 a day, +134%, 11x, 0.44%, 28% to 58%, minus 73%) are written by hand from THESIS.md; update the caption lines in `shots.json` to match `data/derived/metrics.json` before rendering.
