const {app, net, shell} = require('electron')
const {macUpdate} = require('./release')

const LATEST_RELEASE = 'https://api.github.com/repos/onlineslav/watch-with-friends/releases/latest'

// Windows checks the GitHub releases once at launch and installs a newer version without asking.
// Mac can't: Squirrel.Mac refuses to update an app that isn't signed with a Developer ID, and the
// Mac builds are ad-hoc signed. There the home screen offers the download instead (checkMacUpdate).
let inRoom = false
let downloaded = false
let macRelease = null

// Required lazily, so a Mac never creates the updater it can't use.
const autoUpdater = () => require('electron-updater').autoUpdater

// Silent install, then the installer relaunches the app.
const install = () => autoUpdater().quitAndInstall(true, true)

// A finished download waits while you're in a room, so an update never cuts off a watch session.
function setInRoom(value) {
  inRoom = Boolean(value)
  if (!inRoom && downloaded) install()
}

function checkForUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') return
  const updater = autoUpdater()
  updater.on('update-downloaded', () => {
    downloaded = true
    if (!inRoom) install()
  })
  updater.on('error', (error) => console.error('Update failed:', error.message))
  updater.checkForUpdates().catch(() => {})
}

async function checkMacUpdate() {
  if (!app.isPackaged || process.platform !== 'darwin') return null
  try {
    const response = await net.fetch(LATEST_RELEASE, {headers: {Accept: 'application/vnd.github+json'}})
    macRelease = response.ok ? macUpdate(await response.json(), app.getVersion(), process.arch) : null
  } catch {
    macRelease = null
  }
  return macRelease && {version: macRelease.version}
}

// Opens only the links of the release checkMacUpdate found, never a URL from the renderer.
function openMacUpdate(which) {
  const url = macRelease?.[which === 'page' ? 'page' : 'download']
  if (url) shell.openExternal(url)
}

module.exports = {checkForUpdates, checkMacUpdate, openMacUpdate, setInRoom}
