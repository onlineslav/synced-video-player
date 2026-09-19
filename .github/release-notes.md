## What's new in 0.5.0

**Synced Video Player is now Watch With Friends.** Updating keeps everything: your
username, friends list and saved rooms carry over on first launch, and you stay
connected to friends still on 0.4.

Windows installs the update automatically; on a Mac, use the download button on the home screen.

- **UI scale:** Ctrl and `+` / `-` / `0` or Ctrl and the scroll wheel resize the whole app, and Settings has a slider and a typed percent for anything between 50% and 200%.
- **Drop a YouTube link on the video** to play it, the same as dropping a file.
- **Steadier drawing:** the pen no longer stops mid-line, and each tool has its own cursor.
- **Playlist rows show position out of total**, so you can see how far into an item you are without opening it.
- **Tidier home screen:** a long list of saved rooms scrolls on its own instead of pushing the page, the edges light up under the pointer, and the version label links to the project page.
- **Room name** has a clearer field that saves with a checkmark, and the people sidebar closes when you click away from it.

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
