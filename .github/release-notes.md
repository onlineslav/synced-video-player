## What's new in 0.4.0

**Everyone needs 0.4.0 to use persistent rooms together.** Windows installs the update automatically; on a Mac, use the download button on the home screen.

- **Persistent rooms:** rooms now remain on the home screen after everyone leaves or restarts the app. Room names, playlists, ordering, removals and loop state are restored when you return.
- **Resume where you stopped:** each playlist item remembers its own playback position. Choose **Resume** when reopening a room to continue from the saved item and progress.
- **Live room presence:** saved-room cards show who is currently inside without making you join the room.
- **Files stay private:** local paths never leave their owner's computer. Missing or offline files remain in the playlist as unavailable and return when their owner reconnects.
- **Better handoff:** if the active host leaves, another participant advances to the next available playlist item.
- **More reliable audio:** shared audio recovers correctly when a stream switches its capture track.

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
