## What's new in 0.4.3

Windows installs the update automatically; on a Mac, use the download button on the home screen.

- **YouTube playback:** add individual videos or full playlists by URL and watch them together with synchronized playback controls.
- **Faster playlist building:** add local files or YouTube links from the playlist sidebar, or drag a YouTube URL directly into the app.
- **Persistent media preview:** reopening a saved room restores its last media item and progress as a paused local preview.
- **Safer playlist changes:** newly added media starts paused, and removing the current item selects the next available item without unexpectedly starting playback.
- **Annotation visibility:** annotations are shown by default and have a persistent visibility toggle with a smoother hover reveal.
- **Clearer room controls:** the home screen now makes permanent room departure explicit.

## Download

Download the file for your computer from **Assets** below:

| Computer | File |
| --- | --- |
| Windows | `watch-with-friends-...-windows-setup.exe` |
| Mac with Apple Silicon (M1, M2, M3, M4...) | `watch-with-friends-...-mac-arm64.dmg` |
| Mac with Intel | `watch-with-friends-...-mac-x64.dmg` |

Not sure which Mac you have? Open the Apple menu, then **About This Mac**. "Chip: Apple M..." means Apple Silicon; "Processor: Intel" means Intel.

## First launch

- **Windows:** run the installer. If a blue SmartScreen box appears, click **More info**, then **Run anyway**.
- **Mac:** open the `.dmg` and drag the app into **Applications**. Then open **Terminal**, paste this line, and press Enter (only needed once):

  ```sh
  xattr -cr "/Applications/Watch With Friends.app"
  ```

## Watching together

1. Pick a username and display name the first time the app opens.
2. One person clicks **Create a room** and sends the code to the other, or invites them from the friends list.
3. The other person types the code and clicks **Join**.
4. Add local media or a YouTube link. Everyone can pause, seek, and pick their own subtitles for local media.
