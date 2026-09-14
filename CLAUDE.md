# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm start                        # esbuild-bundles the renderer, then launches Electron
npm test                         # all unit tests (node:test, finds test/*.test.{js,mjs})
node --test test/plan.test.js    # a single test file
npm run bundle                   # renderer/app.js -> renderer/bundle.js (generated, gitignored)
npm run dist:win                 # NSIS installer in dist/
npm run dist:mac                 # .dmg in dist/, only works on macOS (CI builds both, see .github/workflows/build.yml)
```

- `renderer/bundle.js` is what the window loads. Re-run `npm run bundle` after editing anything in `renderer/` or `shared/`.
- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node so `require('electron')` fails. `npm start` goes through `scripts/electron.js`, which removes it; run Electron directly (`electron .`) and you have to unset it yourself.

## Architecture

A two-person watch-together app. There is no server: peers find each other through Trystero's public Nostr relays and then connect directly over WebRTC.

**Media path (host only):** file → ffmpeg (main process) → fragmented MP4 on stdout → renderer pulls chunks over IPC → MediaSource on the host's `<video>` → `video.captureStream()` → WebRTC → viewer's `<video>`. The viewer never has the file. Everything it sees, including subtitles, is in the WebRTC stream.

- `main/plan.js`: pure decisions, unit-tested. Pass video through vs. transcode to H.264, ffmpeg args, subtitle burn-in filter graphs, HDR tonemap. Change behaviour here, not in `media.js`.
- `main/media.js`: runs ffprobe/ffmpeg. Detects a working hardware encoder once (nvenc/qsv/amf/videotoolbox, else libx264). Sessions are pull-based: `pull()` drains stdout, and ffmpeg blocks when the renderer stops pulling.
- `renderer/player.mjs`: the MediaSource pipeline. Seeking inside the buffer is a plain `currentTime` set. Seeking outside it, or changing audio/subtitle track, restarts ffmpeg at that time and resets the SourceBuffer (`abort`, `changeType`, `remove`). Keeps about 45s buffered ahead. If Chromium fails to decode a passthrough stream, it retries once with `forceTranscode`.
- `renderer/app.js`: the room and sync layer. The host is authoritative. It broadcasts a `state` action once a second and on every media event. The viewer interpolates time from it and sends `command` actions (play/pause/seek/audio/subtitle), which the host applies. Whoever opens a file claims host; when two claims collide, the newer `claimedAt` wins (`isNewerClaim`).
- `shared/codecs.json`: MediaSource codec strings. The main process uses it for mime types; the renderer uses it to probe `isTypeSupported`.
- `main/turn.js`: optional TURN relay for networks where direct WebRTC fails, read from `config/turn.json` (Cloudflare key or a static `iceServers` list). With no file, STUN only.

## Verified constraints (don't regress these)

- **Only 8-bit video may pass through.** 10-bit HEVC/AV1/VP9 plays locally, but `captureStream` sends WebRTC solid black frames. `copyCodecString` forces a transcode.
- **Stream-copy seeks:** ffmpeg backs input seeks off by ~0.13s for B-frame video and lands on the previous keyframe. `media.js` looks up the keyframe with `ffprobe -read_intervals`, and `plan.js` seeks to keyframe + 0.2s. The MP4 muxer normalizes output timestamps to 0 even with `-copyts`, so the renderer sets `sourceBuffer.timestampOffset = offset`.
- **Burned-in subtitles** need `-copyts` for correct timing. The `subtitles` filter gets a relative filename with the process `cwd` set to the file's folder, which avoids Windows drive-letter colons in the filter graph. The filename is escaped twice (`escapeFilterValue`). Image subtitles (PGS/VobSub) use `overlay` in `-filter_complex`.
- **New `video.src` means new captured tracks.** The host republishes its stream on `loadedmetadata`. Seeks and track changes keep the same MediaSource, so the stream isn't interrupted.
- **Don't send `captureStream()` video.** It samples on a fixed 30fps timer: 24fps films judder and 60fps is halved. `renderer/frames.mjs` forwards presented frames through `MediaStreamTrackGenerator` instead, and `captureStream()` supplies only the audio.
- **`requestVideoFrameCallback` fires ~1/s while the window is minimized.** `frames.mjs` falls back to polling `new VideoFrame(video)`, skipping frames whose timestamp hasn't changed. Frames are re-stamped with wall-clock time because media timestamps jump backwards on seek.
- **Codec:** `app.js` puts H.264 first via `setCodecPreferences` (hardware encode/decode on Mac and Windows; VP8 is software).
- **Connection telemetry** (`renderer/telemetry.mjs`, pure and unit-tested): every 2s each side reads `getStats()`. The viewer grows its receiver `jitterBufferTarget` from 250ms up to 1.5s on freezes, packet loss or jitter, and shrinks it after 30s of calm. It reports what it receives to the host through the `telemetry` action; the host includes its own send limits (`qualityLimitationReason`) in `state`. Both feed the top-bar badge. Freezes only count after 4s of uninterrupted host playback (`nextSteady`), because pauses, seeks and ffmpeg restarts (the state's `epoch`) stall the stream on purpose.
- **Audio quality:** WebRTC Opus is mono by default. `app.js` patches `setRemoteDescription` to add `stereo=1` and an `x-google-start-bitrate` hint, so video doesn't start blurry. `tuneSenders` raises bitrate caps and scales video above 1080p down.
- **Packaging:** ffmpeg/ffprobe must be in `asarUnpack` (paths are rewritten `app.asar` → `app.asar.unpacked`). `ffprobe-static` ships every platform's binary, so the per-platform `files` excludes in `package.json` matter. Mac builds are ad-hoc signed (`identity: "-"`) and not notarized.
