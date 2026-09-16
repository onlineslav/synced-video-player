## What's new in 0.4.1

**Everyone needs 0.4.1 to connect to rooms together.** Windows installs the update automatically; on a Mac, use the download button on the home screen.

- **Room joining fixed:** friends, rooms and saved-room presence share an established connection again. This restores the reliable behavior from 0.3 when public discovery is delayed or unavailable.
- **Reliable reconnecting:** leaving and rejoining a room continues to work through the existing friend connection.
- **Version shown on Home:** the installed version now appears in the lower-left corner, making it easy to confirm both people are up to date.

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
