// Real WebRTC and application code; only discovery is replaced with local IPC.
// Hidden windows use disposable identities, synthetic media, and no public relays.
const {app, BrowserWindow, ipcMain} = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const {execFileSync} = require('node:child_process')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'synced-network-test-'))
app.setPath('userData', path.join(temporary, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const run = (win, source) => win.webContents.executeJavaScript(source).catch((error) => { throw new Error(`${error.message}\nExecuting: ${source}`) })
async function until(win, condition, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await run(win, condition)) return
    await pause(100)
  }
  console.error(await run(win, `JSON.stringify({role:__test.session.role, peers:[...__test.session.peers], remote:__test.session.remote, connection:__test.session.connection, video:{ready:document.getElementById('remote-video').readyState, frames:document.getElementById('remote-video').getVideoPlaybackQuality().totalVideoFrames}, errors:__test.errors})`))
  assert.fail(`Timed out: ${condition}`)
}

async function fixtures() {
  const subscriptions = new Map()
  ipcMain.on('test:subscribe', (event, topic, active) => {
    const topics = subscriptions.get(event.sender) || new Set()
    if (active) topics.add(topic)
    else topics.delete(topic)
    subscriptions.set(event.sender, topics)
  })
  ipcMain.on('test:publish', (event, topic, message) => {
    for (const [contents, topics] of subscriptions) {
      if (contents !== event.sender && !contents.isDestroyed() && topics.has(topic)) contents.send('test:signal', topic, message)
    }
  })
  fs.writeFileSync(path.join(temporary, 'preload.js'), fs.readFileSync(path.join(root, 'main/preload.js'), 'utf8') + `
    const subscriptions = new Map();
    ipcRenderer.on('test:signal', (_event, topic, message) => {
      for (const handler of subscriptions.get(topic) || []) handler(topic, message);
    });
    contextBridge.exposeInMainWorld('__signal', {
      subscribe(topic, handler) {
        if (!subscriptions.has(topic)) subscriptions.set(topic, new Set());
        subscriptions.get(topic).add(handler);
        ipcRenderer.send('test:subscribe', topic, true);
        return () => {
          subscriptions.get(topic)?.delete(handler);
          if (!subscriptions.get(topic)?.size) ipcRenderer.send('test:subscribe', topic, false);
        };
      },
      publish: (topic, message) => ipcRenderer.send('test:publish', topic, message),
    });
  `)
  const source = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8') + `
    window.__test = {
      get session() { return session }, get identity() { return identity },
      friendNetwork, enterRoom, leaveRoom, hostFile, control, receiveImage, shownImage, selectSubtitle,
      audioState: () => ({running: audio?.state === 'running', connected: Boolean(remoteAudio)}),
      getState: hostState, selfId, errors: [],
    };
    window.addEventListener('error', (e) => __test.errors.push(e.message));
    window.addEventListener('unhandledrejection', (e) => __test.errors.push(String(e.reason)));
  `
  await esbuild.build({stdin: {contents: source, resolveDir: path.join(root, 'renderer')}, bundle: true, format: 'iife', target: 'chrome130', outfile: path.join(temporary, 'bundle.js'), plugins: [{
    name: 'local-discovery', setup(build) {
      build.onResolve({filter: /^trystero$/}, () => ({path: 'trystero', namespace: 'local'}))
      build.onLoad({filter: /.*/, namespace: 'local'}, () => ({resolveDir: root, contents: `
        import {createTopicStrategy, selfId} from './node_modules/@trystero-p2p/core/dist/index.mjs';
        const join = createTopicStrategy({
          init: () => [{}], steadyAnnounceIntervalMs: 1000,
          subscribeTopic: (_relay, topic, handler) => window.__signal.subscribe(topic, handler),
          publishTopic: (_relay, topic, message) => window.__signal.publish(topic, message),
        });
        export {selfId};
        export const joinRoom = (config, code, callbacks) => join({...config,
          rtcConfig: {iceServers: []}, turnConfig: [], _test_only_mdnsHostFallbackToLoopback: true,
        }, code, callbacks);
      `}))
    },
  }]})
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8')
    .replace('href="styles.css"', `href="${pathToFileURL(path.join(root, 'renderer/styles.css'))}"`)
  fs.writeFileSync(path.join(temporary, 'index.html'), html)
  const video = path.join(temporary, 'sample.mp4')
  execFileSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video], {windowsHide: true, timeout: 15000})
  fs.writeFileSync(path.join(temporary, 'sample.srt'), '1\n00:00:00,000 --> 00:00:20,000\nShared test caption\n')
  const sound = path.join(temporary, 'sound.m4a')
  execFileSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30', '-c:a', 'aac', sound], {windowsHide: true, timeout: 15000})
  const picture = path.join(temporary, 'picture.png')
  execFileSync(require('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=64x64', '-frames:v', '1', picture], {windowsHide: true, timeout: 15000})
  return {video, picture, sound}
}

app.whenReady().then(async () => {
  const windows = []
  const watchdog = setTimeout(() => { console.error('Network integration check exceeded 120 seconds'); app.exit(1) }, 120000)
  try {
    const {video, picture, sound} = await fixtures()
    require('../main/main').registerIpc()
    ipcMain.removeHandler('net:ice-servers')
    ipcMain.handle('net:ice-servers', () => [])
    for (const name of ['alpha', 'bravo', 'charlie']) {
      const win = new BrowserWindow({show: false, webPreferences: {partition: `network-${name}`, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', preload: path.join(temporary, 'preload.js')}})
      windows.push(win)
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') console.error(`${name}: ${details.message}`)
      })
      await win.loadFile(path.join(temporary, 'index.html'))
      await until(win, 'window.__test && !document.getElementById("welcome").hidden')
      await run(win, `document.getElementById('handle').value=${JSON.stringify(name)}; document.getElementById('welcome-name').value=${JSON.stringify(name)}; document.getElementById('welcome-form').dispatchEvent(new Event('submit', {cancelable:true}));`)
      await until(win, '__test.friendNetwork.identity && !document.getElementById("home").hidden')
    }
    const [a, b, c] = windows
    const names = await Promise.all(windows.map((win) => run(win, '__test.identity.username')))
    await run(a, `__test.friendNetwork.add(${JSON.stringify(names[1])})`)
    await until(b, '__test.friendNetwork.requests.size === 1')
    await run(b, `__test.friendNetwork.add(${JSON.stringify(names[0])})`)
    await Promise.all([a, b].map((win) => until(win, '__test.friendNetwork.online.size === 1')))
    console.log('PASS: Signed friend request, acceptance and presence over real local WebRTC')

    const joinAll = () => Promise.all(windows.map((win) => run(win, '__test.enterRoom("ABCDEFGH")')))
    const connected = () => Promise.all(windows.map((win) => until(win, '__test.session.peers.size === 2')))
    await run(a, '__test.enterRoom("ABCDEFGH", {joining:false})')
    assert.equal(await run(a, 'document.getElementById("room-name").value'), "alpha's Room")
    await run(a, `
      if (document.getElementById('room').classList.contains('people-open')) document.getElementById('people-toggle').click();
      document.getElementById('people-toggle').click();
    `)
    assert.equal(await run(a, 'document.getElementById("room-name").checkVisibility()'), true)
    assert.equal(await run(a, '__test.session.peers.size'), 0)
    await run(a, `document.getElementById('room-name').value='  Movie   Night  '; document.getElementById('room-name-form').requestSubmit();`)
    assert.equal(await run(a, 'document.getElementById("room-name").value'), 'Movie Night')
    await run(a, `document.getElementById('room-name').value='   '; document.getElementById('room-name-form').requestSubmit();`)
    assert.equal(await run(a, 'document.getElementById("room-name").value'), 'Movie Night')
    console.log('PASS: Couch shows the default room name before anyone joins; edits save and blank names preserve it')
    await Promise.all([b, c].map((win) => run(win, '__test.enterRoom("ABCDEFGH")')))
    await connected()
    await Promise.all([b, c].map((win) => until(win, 'document.getElementById("room-name").value === "Movie Night"')))
    await run(b, `document.getElementById('room-name').value='Film Club'; document.getElementById('room-name-form').requestSubmit();`)
    await Promise.all([a, c].map((win) => until(win, 'document.getElementById("room-name").value === "Film Club"')))
    console.log('PASS: New arrivals receive the saved room name and subsequent edits synchronize')
    console.log('PASS: Three authenticated room participants connect while friends remain online')
    await run(a, `__test.hostFile(${JSON.stringify(video)})`)
    await Promise.all([b, c].map((win) => until(win, '__test.session.role === "viewer" && document.getElementById("remote-video").getVideoPlaybackQuality().totalVideoFrames > 12')))
    await until(b, '__test.session.clock !== null')
    await Promise.all([b, c].map((win) => until(win, '__test.audioState().running && __test.audioState().connected')))
    console.log('PASS: Both viewers receive moving video and clock synchronization')
    await until(b, '__test.session.remote.subtitles.length === 1')
    assert.equal(await run(b, 'JSON.stringify(__test.session.remote.subtitles).includes("external:")'), false)
    await run(b, '__test.selectSubtitle(__test.session.remote.subtitles[0].value)')
    await until(b, '__test.session.captions.cues.some(cue => cue.text.includes("Shared test caption"))')
    console.log('PASS: Sidecar subtitle cues transfer through opaque track IDs')
    await run(b, '__test.control("pause")')
    await until(a, 'document.getElementById("local-video").paused')
    await until(c, '__test.session.remote.playing === false')
    await run(b, '__test.control("seek", 10)')
    await until(c, 'Math.abs(__test.session.remote.time - 10) < 1')
    await run(b, '__test.control("play")')
    await until(a, '!document.getElementById("local-video").paused')
    console.log('PASS: Viewer pause, seek and resume reach the host and other viewer')
    await run(c, `__test.hostFile(${JSON.stringify(video)})`)
    await until(a, '__test.session.role === "viewer" && document.getElementById("remote-video").readyState >= 2')
    await until(b, '__test.session.peerStreams.get(__test.session.hostId)?.claimedAt === __test.session.remote.claimedAt')
    console.log('PASS: Host takeover attaches the stream for the new media revision')
    await run(c, `__test.hostFile(${JSON.stringify(path.join(temporary, 'missing.mp4'))})`)
    await Promise.all([a, b].map((win) => until(win, 'Boolean(__test.session.remote?.error) && document.getElementById("spinner").hidden')))
    console.log('PASS: A failed host file reaches both viewers as a terminal error')
    await run(c, `__test.hostFile(${JSON.stringify(picture)})`)
    await Promise.all([a, b].map((win) => until(win, 'Boolean(__test.shownImage())')))
    await run(b, `const current=__test.session.images.get(__test.session.hostId); __test.receiveImage(new Uint8Array([0]),__test.session.hostId,{id:String(current.claimedAt-1),claimedAt:current.claimedAt-1,mime:'image/png'}); if (__test.shownImage() !== current) throw Error('Stale image replaced current image');`)
    console.log('PASS: Full image transfer and stale-image rejection')
    await run(c, `__test.hostFile(${JSON.stringify(sound)})`)
    await Promise.all([a, b].map((win) => until(win, '__test.session.remote?.audioOnly && __test.session.lastInbound?.packetsReceived > 0 && __test.audioState().connected')))
    console.log('PASS: Audio-only playback and packet telemetry after video/image switches')
    for (let i = 0; i < 2; i++) {
      await Promise.all(windows.map((win) => run(win, '__test.leaveRoom()')))
      await joinAll()
      await connected()
    }
    await Promise.all([a, b].map((win) => until(win, '__test.friendNetwork.online.size === 1')))
    for (const win of windows) assert.deepEqual(await run(win, '__test.errors'), [])
    console.log('PASS: Two leave/rejoin cycles retain friends and produce no renderer exceptions')
  } finally {
    clearTimeout(watchdog)
    for (const win of windows) if (!win.isDestroyed()) win.destroy()
    require('../main/media').stopAll()
  }
}).then(() => app.exit(0), (error) => { console.error(error); app.exit(1) })
