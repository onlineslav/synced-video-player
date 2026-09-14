// Starts Electron for `npm start`. VS Code's terminals set ELECTRON_RUN_AS_NODE=1, which makes
// Electron run as plain Node, so the app would crash before opening a window.
const {spawn} = require('node:child_process')
const electron = require('electron')

const env = {...process.env}
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, process.argv.slice(2), {stdio: 'inherit', env})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
