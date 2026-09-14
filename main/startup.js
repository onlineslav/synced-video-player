const fs = require('node:fs')
const path = require('node:path')

// The installed app and `npm start` must never open the same Chromium databases.
// A second process can block localStorage for seconds and fail to open the cache.
function prepareProfile(app) {
  if (!app.isPackaged) {
    const profile = path.join(app.getPath('appData'), 'Synced Video Player Development')
    fs.mkdirSync(profile, {recursive: true})
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
  }
  return app.requestSingleInstanceLock()
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

module.exports = {prepareProfile, focusWindow}
