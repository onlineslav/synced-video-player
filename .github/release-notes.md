## What's new in 0.3.0

**Everyone needs 0.3.0.** It can't connect to older versions. Windows 0.2.0 updates itself; on a Mac, use the download button on the home screen.

- **Up to eight people** in a room.
- **Smoother playback:** video quality adjusts for each viewer's connection, and play/pause/seek and subtitles line up more closely.
- **Clearer connection info:** the indicator explains packet loss, slow uploads and relay use. A host that stops responding shows as stalled, and a file that fails to open shows an error for everyone.
- **Friends:** friend requests and who's online are easier to see, and unanswered requests expire with a Retry button.
- **Room name:** view and edit it from the couch panel.
- **Safer rooms:** people must prove who they are to join, and nobody in a room can make your app open files or links.
- **Faster startup:** no more stalls while connecting.

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
