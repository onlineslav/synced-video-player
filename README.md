# Synced Video Player

Watch a video file together from two computers (Windows or Mac, in any combination). One person hosts and streams the file. Either person can play, pause, seek, or switch the audio track, and both see the change.

- Plays almost anything VLC plays (MKV, HEVC, AV1, AC3/DTS/TrueHD audio, XviD, 10-bit, HDR), because ffmpeg is bundled.
- Subtitles: tracks inside the file, `.srt`/`.ass`/`.ssa`/`.vtt` files next to the video, or any subtitle file you drop in. Each person picks their own track, or none. Image subtitles (Blu-ray PGS, DVD VobSub) can only be drawn into the picture, so those show for everyone.
- No accounts, no port forwarding, no servers to run.

## Using it

1. One person clicks **Create a room** and sends the code (e.g. `K7QM-2XPA`) to the other.
2. The other person types the code and clicks **Join**.
3. Whoever clicks **Open video** (or drops a file on the window) hosts it. If the other person opens a video later, they become the host.

Shortcuts: `Space` play/pause · `←`/`→` 10 seconds · `F` fullscreen · `M` mute.

## Installing

**[Download the latest release](https://github.com/onlineslav/synced-video-player/releases/latest)**

- **Windows:** run `synced-video-player-…-windows-setup.exe`. If SmartScreen appears, click **More info → Run anyway** (once).
- **Mac:** open the `.dmg` for your Mac (`arm64` = Apple Silicon, `x64` = Intel) and drag the app to Applications. The app isn't notarized, so run this in Terminal once before the first launch:

  ```sh
  xattr -cr "/Applications/Synced Video Player.app"
  ```

## Connection problems

The two apps connect directly using WebRTC. That works on most home networks with no setup. Some networks block direct connections: mobile hotspots, some ISPs using CGNAT, and corporate or university Wi-Fi. There the apps stay on "Waiting for your friend…". The fix is a TURN relay that forwards traffic between the two apps. Cloudflare's is free up to 1,000 GB a month:

1. In the Cloudflare dashboard, go to **Realtime → TURN Server** and create a TURN key.
2. Copy `config/turn.example.json` to `config/turn.json` and fill in the key ID and API token.
3. Rebuild. For CI builds, save the contents of that file as a repository secret named `TURN_CONFIG`.

`config/turn.json` can also hold a static list in the form `{"iceServers": [{"urls": "turn:…", "username": "…", "credential": "…"}]}`.

## Development

```sh
npm install
npm start        # bundle the renderer and launch the app
npm test         # unit tests (node:test)
npm run dist:win # Windows installer in dist/
npm run dist:mac # Mac .dmg in dist/ (must run on a Mac)
```

Starting the **Build** workflow by hand builds Windows, Apple Silicon and Intel Mac installers as workflow artifacts. Pushing a version tag builds them and publishes a GitHub Release:

```sh
npm version patch   # bumps package.json and creates the tag
git push --follow-tags
```
