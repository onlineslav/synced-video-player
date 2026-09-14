const path = require('node:path')
const {app, BrowserWindow, dialog, ipcMain} = require('electron')
const media = require('./media')
const {loadIceServers} = require('./turn')
const updater = require('./updater')
const IMAGES = require('../shared/images.json')

const MEDIA_EXTENSIONS = [
  'mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'wmv', 'flv', 'ts', 'm2ts', 'mts',
  'mpg', 'mpeg', 'vob', 'ogv', '3gp', 'divx', 'rmvb', 'asf', 'f4v',
  'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'alac', 'ape', 'mka', 'ac3', 'dts',
  ...Object.keys(IMAGES.native), ...IMAGES.convert,
]
const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt']

const turnConfigPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'turn.json') : path.join(__dirname, '..', 'config', 'turn.json')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0b0b0f',
    title: 'Synced Video Player',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The host keeps streaming while its window is minimized or behind other windows.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  return win
}

async function pickFiles(event, name, extensions, multiple = false) {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    properties: ['openFile', ...(multiple ? ['multiSelections'] : [])],
    filters: [{name, extensions}, {name: 'All files', extensions: ['*']}],
  })
  return result.canceled ? [] : result.filePaths
}

const pickFile = (event, name, extensions) => pickFiles(event, name, extensions).then((paths) => paths[0] || null)

function registerIpc() {
  ipcMain.handle('dialog:media', (event) => pickFile(event, 'Media', MEDIA_EXTENSIONS))
  ipcMain.handle('dialog:media-files', (event) => pickFiles(event, 'Media', MEDIA_EXTENSIONS, true))
  ipcMain.handle('dialog:subtitle', (event) => pickFile(event, 'Subtitles', SUBTITLE_EXTENSIONS))
  ipcMain.handle('media:probe', (_event, filePath) => media.probe(filePath))
  ipcMain.handle('media:image', (_event, filePath) => media.readImage(filePath))
  ipcMain.handle('session:start', (_event, options) => media.startSession(options))
  ipcMain.handle('session:pull', (_event, id) => media.pull(id))
  ipcMain.handle('session:stop', (_event, id) => media.stopSession(id))
  ipcMain.handle('subtitle:cues', (_event, options) => media.subtitleCues(options))
  ipcMain.handle('net:ice-servers', () => loadIceServers(turnConfigPath()))
  ipcMain.handle('window:pin', (event, pinned) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win.setAlwaysOnTop(Boolean(pinned), 'floating')
    return win.isAlwaysOnTop()
  })
  ipcMain.on('app:in-room', (_event, inRoom) => updater.setInRoom(inRoom))
  ipcMain.handle('update:check', () => updater.checkMacUpdate())
  ipcMain.handle('update:open', (_event, which) => updater.openMacUpdate(which))
}

function start() {
  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    media.detectCapabilities() // warm up so the first transcode starts instantly
    updater.checkForUpdates()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => media.stopAll())
}

module.exports = {createWindow, registerIpc, start}
