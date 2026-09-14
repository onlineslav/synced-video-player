## What's new in 0.2.0

- **Friends:** pick a username, add friends, see who's online or hosting, ask to join their room or invite them into yours.
- **Playlist:** anyone can add files, drag to reorder, and the next one plays when a file ends.
- **More than video:** open audio files and pictures (sent at full resolution).
- **Draw together** on a whiteboard over the video, with an eraser.
- **Reactions:** air horn, golf clap, quack and confetti.
- **Your own subtitles:** each person picks their own subtitle track, or none.
- **Player:** synced loop, mute, volume up to 200%, keep the window on top, and controls that hide while playing.
- **Updates:** from this version on, Windows updates itself. Macs show a download button when a new version is out.

## Download

Download the file for your computer from **Assets** below:

| Computer | File |
| --- | --- |
| Windows | `synced-video-player-…-windows-setup.exe` |
| Mac with Apple Silicon (M1, M2, M3, M4…) | `synced-video-player-…-mac-arm64.dmg` |
| Mac with Intel | `synced-video-player-…-mac-x64.dmg` |

Not sure which Mac you have? Open the Apple menu → **About This Mac**. "Chip: Apple M…" means Apple Silicon; "Processor: Intel" means Intel.

## First launch

- **Windows:** run the installer. If a blue SmartScreen box appears, click **More info → Run anyway**.
- **Mac:** open the `.dmg` and drag the app into **Applications**. Then open **Terminal**, paste this line, and press Enter (only needed once):

  ```sh
  xattr -cr "/Applications/Synced Video Player.app"
  ```

## Watching together

1. Pick a username and display name the first time the app opens.
2. One person clicks **Create a room** and sends the code to the other, or invites them from the friends list.
3. The other person types the code and clicks **Join**.
4. Whoever clicks **Open media** (or drops a file on the window) hosts it. Everyone can pause, seek, and pick their own subtitles.
