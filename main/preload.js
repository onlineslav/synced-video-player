const {contextBridge, ipcRenderer, webUtils} = require('electron')

contextBridge.exposeInMainWorld('api', {
  chooseVideo: () => ipcRenderer.invoke('dialog:video'),
  chooseSubtitle: () => ipcRenderer.invoke('dialog:subtitle'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  startSession: (options) => ipcRenderer.invoke('session:start', options),
  pull: (sessionId) => ipcRenderer.invoke('session:pull', sessionId),
  stopSession: (sessionId) => ipcRenderer.invoke('session:stop', sessionId),
  subtitleCues: (options) => ipcRenderer.invoke('subtitle:cues', options),
  iceServers: () => ipcRenderer.invoke('net:ice-servers'),
})
