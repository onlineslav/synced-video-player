const fs = require('node:fs')
const path = require('node:path')

// The app was called "Synced Video Player" up to 0.4.3. Electron derives userData from
// productName, so the rename alone would hand every existing install an empty profile:
// no identity, no friends, no saved rooms. carryOverProfile copies the old folder once,
// before Chromium opens a single database.
const OLD_NAME = 'Synced Video Player'
const NEW_NAME = 'Watch With Friends'
const MIGRATED = '.migrated-from-synced-video-player'

// Caches are disposable and can be hundreds of megabytes; the singleton locks belong to the
// process that made them and a dangling symlink would abort the copy.
const SKIP = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'ShaderCache', 'Crashpad',
  'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile',
])

const isEmpty = (dir) => {
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return true // missing counts as empty
  }
}

// Copies `from` to `to` once. Skipped when the new profile already holds anything, or once the
// marker says this copy already happened, so a profile someone cleared out stays cleared.
function carryOverProfile(from, to) {
  if (fs.existsSync(path.join(to, MIGRATED)) || !isEmpty(to) || !fs.existsSync(from)) return false
  try {
    fs.cpSync(from, to, {recursive: true, filter: (source) => !SKIP.has(path.basename(source))})
    fs.writeFileSync(path.join(to, MIGRATED), `${new Date().toISOString()}\n`)
    return true
  } catch (error) {
    // A half-copied profile is worse than a fresh one: Chromium would reopen a torn database.
    fs.rmSync(to, {recursive: true, force: true})
    fs.mkdirSync(to, {recursive: true})
    console.error('Could not carry over the previous profile:', error.message)
    return false
  }
}

// The installed app and `npm start` must never open the same Chromium databases.
// A second process can block localStorage for seconds and fail to open the cache.
function prepareProfile(app) {
  const appData = app.getPath('appData')
  if (app.isPackaged) {
    const profile = app.getPath('userData')
    fs.mkdirSync(profile, {recursive: true})
    carryOverProfile(path.join(appData, OLD_NAME), profile)
  } else {
    const profile = path.join(appData, `${NEW_NAME} Development`)
    fs.mkdirSync(profile, {recursive: true})
    carryOverProfile(path.join(appData, `${OLD_NAME} Development`), profile)
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

module.exports = {prepareProfile, focusWindow, carryOverProfile}
