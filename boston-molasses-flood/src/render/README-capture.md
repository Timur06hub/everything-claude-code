# capture.js

Deterministic PNG frame capture (Playwright/Chromium, 1920x1080 viewport).

    node src/render/capture.js <scene.html> <duration_s> <fps> <outDir> [--scale 0.25] [--frames-limit N]

- Scene must expose `window.__setTime(seconds)` (sync or async). Called once per frame with `i / fps`; two rAFs are awaited before each screenshot.
- Frames: `<outDir>/frame_000001.png`, ... (frame count = round(duration * fps), capped by `--frames-limit`).
- `--scale` sets deviceScaleFactor (0.25 gives 480x270 previews).
- Also exports `{ parseArgs, capture }`. Test: `node tests/capture/capture.test.js`.
- Encode e.g.: `ffmpeg -framerate 30 -i out/frame_%06d.png -c:v libx264 -pix_fmt yuv420p out.mp4`
