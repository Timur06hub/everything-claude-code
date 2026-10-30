# assemble.sh

Encodes each scene's PNG sequence to H.264, joins scenes with transitions, and muxes audio.

    src/render/assemble.sh --config scenes.json --out out.mp4 [--draft] [--workdir DIR] [--keep]

Requires `ffmpeg` (with libx264) and `jq`. `--draft` renders 854x480, ultrafast, CRF 30.
Final output is H.264 yuv420p at the configured size (default 1920x1080) and fps (30), AAC audio.

## scenes.json

Relative paths resolve against the config file's directory.

```json
{
  "fps": 30, "width": 1920, "height": 1080,
  "pattern": "%05d.png",
  "default_transition": { "type": "crossfade", "duration": 0.5 },
  "audio": {
    "voiceover": "vo.wav", "music": "music.wav",
    "music_volume": 0.3, "duck_threshold": 0.03, "duck_ratio": 8
  },
  "scenes": [
    { "frames": "frames/s01", "duration": 8, "transition": { "type": "dip", "duration": 1 } },
    { "frames": "frames/s02" }
  ]
}
```

- `duration` (optional): defaults to frame count / fps. Longer than the frames holds the last frame; shorter trims.
- `transition` on a scene is the one leaving it (ignored on the last scene). Types: `crossfade`, `dip` (to black), `cut`, or any ffmpeg xfade name. Duration is clamped to fit neighbouring scenes.
- Audio is optional. Music loops/trims to the video length and is ducked under the voiceover via sidechain compression; the mix fades out over the last 1.5s.

Test: `bash tests/assemble/run-test.sh` (synthetic 96x54 clips only).
