# Synced Video Player

Watch or listen to a media file together from two computers (Windows or Mac, in any combination). One person hosts and streams the file. Either person can play, pause, seek, or switch the audio track, and both see the change.

- Plays almost anything VLC plays (MKV, HEVC, AV1, AC3/DTS/TrueHD audio, XviD, 10-bit, HDR), plus audio files (MP3, FLAC, WAV, M4A, Opus…), because ffmpeg is bundled.
- Pictures (JPG, PNG, GIF, WebP, AVIF, TIFF, PSD…, up to 50 MB) are sent to the other person at full resolution, so you can both look and draw on them.
- Subtitles: tracks inside the file, `.srt`/`.ass`/`.ssa`/`.vtt` files next to the video, or any subtitle file you drop in. Each person picks their own track, or none. Image subtitles (Blu-ray PGS, DVD VobSub) can only be drawn into the picture, so those show for everyone.
- No accounts, no port forwarding, no servers to run.

## Using it

1. One person clicks **Create a room** and sends the code (e.g. `K7QM-2XPA`) to the other.
2. The other person types the code and clicks **Join**.
3. Whoever clicks **Open media** (or drops a file on the window) hosts it. If the other person opens a file later, they become the host.

In a room you can also draw together on the whiteboard (pen button in the top bar) and send reactions everyone sees and hears: 📯 air horn, 👏 golf clap, 🦆 quack and 🎉 confetti.

The playlist lives behind the tab on the right edge: click it, or drag it out to the width you like. Anyone can add files to it (or drop them on it), drag items to reorder them, and play any item. The file stays on the computer of whoever added it, and their app hosts it when it plays, so an item can't play once that person leaves. When a file ends, the next one starts (unless loop is on).

Shortcuts: `Space` play/pause · `←`/`→` 10 seconds · `F` fullscreen · `M` mute · `P` playlist · `1`–`4` reactions.

### Friends

The first time the app opens it asks for a username and a display name. The app adds a tag to the username so it's yours alone (e.g. `moviefan#k7qm-x3pa`). Send it to a friend, add theirs under **Friends**, and once they click **Add back** you're friends. The friends list shows who's online, who's in a room, and what they're hosting. Click **Ask to join** next to a friend in a room; if they let you in, you join without needing the code. Your display name is separate and can be changed any time. Picking a new username means friends have to add you again.

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
