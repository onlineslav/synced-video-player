## What's new in 0.4.2

Windows installs the update automatically; on a Mac, use the download button on the home screen.

- **Open multiple files:** select several files with Open media to add them to the playlist together.
- **Cleaner resume controls:** resume shows the saved timestamp, with no prompt at the start of a file or for media shorter than 15 seconds.
- **Paused media title:** the filename appears over the player while paused and becomes more visible on hover.
- **Playlist improvements:** removing the active item stops playback, double-clicking the resize edge hides the playlist, and the edge has an updated hover glow.
- **Leave saved rooms:** remove a saved room from Home using its leave control and confirmation dialog.

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
