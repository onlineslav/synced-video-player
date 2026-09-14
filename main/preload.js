const {contextBridge, ipcRenderer, webUtils} = require('electron')

contextBridge.exposeInMainWorld('api', {
  chooseMedia: () => ipcRenderer.invoke('dialog:media'),
  chooseMediaFiles: () => ipcRenderer.invoke('dialog:media-files'),
  chooseSubtitle: () => ipcRenderer.invoke('dialog:subtitle'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  readImage: (filePath) => ipcRenderer.invoke('media:image', filePath),
  startSession: (options) => ipcRenderer.invoke('session:start', options),
  pull: (sessionId) => ipcRenderer.invoke('session:pull', sessionId),
  stopSession: (sessionId) => ipcRenderer.invoke('session:stop', sessionId),
  subtitleCues: (options) => ipcRenderer.invoke('subtitle:cues', options),
  iceServers: () => ipcRenderer.invoke('net:ice-servers'),
  setPinned: (pinned) => ipcRenderer.invoke('window:pin', pinned),
})
