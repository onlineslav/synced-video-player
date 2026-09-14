import {joinRoom, selfId} from 'trystero'
import {
  errorMessage,
  formatRoomCode,
  formatTime,
  generateRoomCode,
  isNewerClaim,
  normalizeRoomCode,
  preferHighStartBitrate,
  preferStereoOpus,
} from './lib.mjs'
import {captureVideoFrames} from './frames.mjs'
import {StreamPlayer} from './player.mjs'
import {captionHtml} from './subtitles.mjs'
import {
  BRUSH_SIZES,
  COLORS,
  addStrokeChunk,
  boardSnapshot,
  clearBoard,
  createBoard,
  drawStroke,
  mergeSnapshot,
  pictureRect,
} from './whiteboard.mjs'
import {
  MIN_BUFFER_MS,
  adaptBuffer,
  describeLink,
  describePeer,
  inboundDelta,
  isSteady,
  isTroubled,
  nextSteady,
  readStats,
} from './telemetry.mjs'

const APP_ID = 'synced-video-player-7c1e4b'
const STATE_INTERVAL_MS = 1000
const VIDEO_MAX_BITRATE = 10_000_000
const AUDIO_MAX_BITRATE = 256_000
const MAX_STREAM_WIDTH = 1920
const TELEMETRY_INTERVAL_MS = 2000
const SUBTITLE_FILE = /\.(srt|ass|ssa|vtt)$/i
const LOAD_SUBTITLE = '__load__'
const LOCAL_SUBTITLE = 'local:' // a subtitle file only this person loaded
const CUES_TIMEOUT_MS = 180_000 // reading a track out of a large file can take a while
const DECODE_DELAY_MS = 40
const CHROME_IDLE_MS = 2500

// The host's encoder follows hints in the viewer's SDP; both sides run this app.
const setRemoteDescription = RTCPeerConnection.prototype.setRemoteDescription
RTCPeerConnection.prototype.setRemoteDescription = function (description, ...rest) {
  if (description?.sdp) {
    description = {type: description.type, sdp: preferHighStartBitrate(preferStereoOpus(description.sdp))}
  }
  return setRemoteDescription.call(this, description, ...rest)
}

// VP8, WebRTC's default, is encoded in software; H.264 gets hardware encode/decode on both
// Mac and Windows, leaving the host's CPU for playback and conversion.
function preferH264(pc) {
  const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs
  if (!codecs) return
  const isH264 = (c) => c.mimeType.toLowerCase() === 'video/h264'
  const ordered = [...codecs.filter(isH264), ...codecs.filter((c) => !isH264(c))]
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.receiver.track?.kind !== 'video') continue
    try {
      transceiver.setCodecPreferences(ordered)
    } catch {}
  }
}
for (const method of ['createOffer', 'createAnswer', 'setLocalDescription']) {
  const original = RTCPeerConnection.prototype[method]
  RTCPeerConnection.prototype[method] = function (...args) {
    preferH264(this)
    return original.apply(this, args)
  }
}

const $ = (id) => document.getElementById(id)
const ui = {
  home: $('home'),
  create: $('create'),
  joinForm: $('join-form'),
  joinCode: $('join-code'),
  room: $('room'),
  code: $('code'),
  peerStatus: $('peer-status'),
  link: $('link'),
  linkWarning: $('link-warning'),
  linkWarningTip: $('link-warning-tip'),
  title: $('title'),
  role: $('role'),
  peopleToggle: $('people-toggle'),
  peopleCount: $('people-count'),
  people: $('people'),
  boardToggle: $('board-toggle'),
  board: $('board'),
  pen: $('pen'),
  swatches: $('swatches'),
  sizes: $('sizes'),
  boardClear: $('board-clear'),
  openButtons: document.querySelectorAll('[data-open-video]'),
  leave: $('leave'),
  stage: $('stage'),
  localVideo: $('local-video'),
  remoteVideo: $('remote-video'),
  captions: $('captions'),
  emptyText: $('empty-text'),
  spinner: $('spinner'),
  toast: $('toast'),
  controls: $('controls'),
  play: $('play'),
  time: $('time'),
  seek: $('seek'),
  duration: $('duration'),
  audio: $('audio-select'),
  subtitles: $('subtitle-select'),
  volume: $('volume'),
  fullscreen: $('fullscreen'),
}

const player = new StreamPlayer(ui.localVideo)

const blankSession = () => ({
  code: null,
  room: null,
  stateAction: null,
  commandAction: null,
  peers: new Set(),
  peerStreams: new Map(),
  people: new Map(), // peerId -> {name, rttMs, relayed, receiver}
  profileAction: null,
  boardAction: null,
  board: createBoard(),
  role: 'idle', // 'idle' | 'host' | 'viewer'
  hostId: null,
  claimedAt: 0,
  remote: null, // latest host state, for viewers
  stream: null, // outgoing stream, for the host
  captured: null, // video.captureStream() backing it
  seeking: false,
  telemetryAction: null,
  link: null, // {rttMs, relayed, sender, receiver} for the connection badge
  lastInbound: null,
  buffer: {bufferMs: MIN_BUFFER_MS, calmMs: 0},
  epoch: 0, // host: bumps whenever ffmpeg restarts, so viewers can tell a restart from a freeze
  steady: {since: null, epoch: 0}, // viewer: when the host's playback last became uninterrupted
  playoutDelayMs: null, // viewer: how far the picture trails the host's clock
  cuesAction: null,
  captions: {mediaKey: null, id: null, cues: [], token: null}, // this person's own text subtitles
  localSubtitles: [], // subtitle files only this person loaded
})
let session = blankSession()

// ---------- Room ----------

async function enterRoom(code) {
  const turnConfig = await window.api.iceServers().catch(() => [])
  const room = joinRoom({appId: APP_ID, password: code, ...(turnConfig.length && {turnConfig})}, code)
  session = {
    ...blankSession(),
    code,
    room,
    stateAction: room.makeAction('state'),
    commandAction: room.makeAction('command'),
    telemetryAction: room.makeAction('telemetry'),
    cuesAction: room.makeAction('cues', {kind: 'request'}),
    profileAction: room.makeAction('profile'),
    boardAction: room.makeAction('board'),
  }
  session.cuesAction.onRequest = ({id}) => hostCues(id)
  session.boardAction.onMessage = (message, {peerId}) => receiveBoard(message, peerId)
  session.profileAction.onMessage = (profile, {peerId}) => {
    if (!session.peers.has(peerId)) return
    person(peerId).name = String(profile?.name || '').slice(0, MAX_NAME_LENGTH) || null
    render()
  }

  room.onPeerJoin = (peerId) => {
    session.peers.add(peerId)
    session.profileAction.send(myProfile(), {target: peerId}).catch(() => {})
    if (session.board.strokes.size) session.boardAction.send({type: 'sync', ...boardSnapshot(session.board)}, {target: peerId}).catch(() => {})
    toast('Friend connected')
    if (session.role === 'host') {
      if (session.stream) Promise.all(room.addStream(session.stream, {target: peerId})).then(tuneSenders, () => {})
      broadcastState(peerId)
    }
    render()
  }

  room.onPeerLeave = (peerId) => {
    session.peers.delete(peerId)
    session.peerStreams.delete(peerId)
    session.people.delete(peerId)
    if (session.role === 'viewer' && peerId === session.hostId) {
      session.hostId = null
      session.remote = null
      ui.remoteVideo.srcObject = null
      setRole('idle')
    }
    toast('Friend left')
    render()
  }

  room.onPeerStream = (stream, peerId) => {
    session.peerStreams.set(peerId, stream)
    applyViewerBuffer(room.getPeers()[peerId])
    attachRemoteStream()
  }

  session.stateAction.onMessage = (state, {peerId}) => receiveState(state, peerId)
  session.commandAction.onMessage = ({cmd, value}) => {
    if (session.role === 'host') applyCommand(cmd, value)
  }
  session.telemetryAction.onMessage = (receiver, {peerId}) => {
    if (session.role !== 'host' || !session.peers.has(peerId)) return
    person(peerId).receiver = receiver
    session.link = {...session.link, receiver}
    render()
  }

  ui.code.textContent = formatRoomCode(code)
  ui.home.hidden = true
  ui.room.hidden = false
  setRole('idle')
}

async function leaveRoom() {
  const room = session.room
  player.close()
  unpublishStream()
  ui.remoteVideo.srcObject = null
  session = blankSession()
  setRole('idle')
  ui.room.hidden = true
  ui.home.hidden = false
  await room?.leave()
}

function setRole(role) {
  session.role = role
  ui.stage.dataset.role = role
  render()
}

// ---------- Hosting ----------

async function hostFile(filePath) {
  if (!session.room) return
  session.claimedAt = Date.now()
  session.hostId = selfId
  session.remote = null
  ui.remoteVideo.srcObject = null
  setRole('host')
  broadcastState()
  try {
    if (await player.open(filePath)) ui.localVideo.play().catch(() => {})
  } catch (err) {
    toast(errorMessage(err), true)
    if (!player.loaded) stopHosting()
  }
  broadcastState()
}

function stopHosting() {
  player.close()
  unpublishStream()
  setRole('idle')
}

// Video comes from captureVideoFrames (true source frame rate); captureStream supplies audio,
// and video too if the frame APIs are unavailable.
function publishStream() {
  unpublishStream()
  const video = ui.localVideo
  const captured = video.captureStream()
  const frames = captureVideoFrames(video)
  const usable = (track) => !(frames && track.kind === 'video')
  for (const track of captured.getTracks()) if (!usable(track)) track.stop()

  const stream = new MediaStream([...(frames ? [frames] : []), ...captured.getTracks().filter(usable)])
  // Films should drop resolution before frame rate when the connection or CPU struggles.
  stream.getVideoTracks().forEach((track) => (track.contentHint = 'motion'))
  session.stream = stream
  session.captured = captured

  captured.addEventListener('addtrack', ({track}) => {
    if (session.stream !== stream || !usable(track)) return track.stop()
    if (track.kind === 'video') track.contentHint = 'motion'
    stream.addTrack(track)
    Promise.all(session.room.addTrack(track, stream)).then(tuneSenders, () => {})
  })
  if (session.peers.size) Promise.all(session.room.addStream(stream)).then(tuneSenders, () => {})
}

function unpublishStream() {
  const stream = session.stream
  if (!stream) return
  session.stream = null
  try {
    session.room?.removeStream(stream)
  } catch {}
  stream.getTracks().forEach((track) => track.stop())
  session.captured?.getTracks().forEach((track) => track.stop())
  session.captured = null
}

// Raise WebRTC's conservative defaults so a movie looks and sounds like a movie.
async function tuneSenders() {
  for (const pc of Object.values(session.room?.getPeers() || {})) {
    for (const sender of pc.getSenders()) {
      const track = sender.track
      const params = sender.getParameters()
      if (!track || !params.encodings?.length) continue
      const encoding = params.encodings[0]
      const maxBitrate = track.kind === 'video' ? VIDEO_MAX_BITRATE : AUDIO_MAX_BITRATE
      const width = track.kind === 'video' ? track.getSettings().width || 0 : 0
      const scale = width > MAX_STREAM_WIDTH ? width / MAX_STREAM_WIDTH : 1
      if (encoding.maxBitrate === maxBitrate && (track.kind !== 'video' || encoding.scaleResolutionDownBy === scale)) continue
      encoding.maxBitrate = maxBitrate
      if (track.kind === 'video') encoding.scaleResolutionDownBy = scale
      await sender.setParameters(params).catch(() => {})
    }
  }
}

function hostState() {
  const media = player.media
  const video = ui.localVideo
  return {
    hostId: selfId,
    claimedAt: session.claimedAt,
    title: media ? media.title || media.name : null,
    loading: !media,
    playing: !video.paused,
    buffering: !video.paused && video.readyState < 3,
    time: video.currentTime,
    duration: player.duration,
    transcoding: player.transcoding,
    audio: (media?.audio || []).map((a) => ({value: String(a.index), label: a.label})),
    audioSelected: player.audioIndex == null ? '' : String(player.audioIndex),
    subtitles: (media?.subtitles || []).map((s) => ({value: s.id, label: s.label, image: s.image, isDefault: s.isDefault})),
    subtitleSelected: player.subtitleId || '',
    sender: session.link?.sender || null,
    // What each viewer reports receiving, so everyone's room list can show it.
    viewers: Object.fromEntries([...session.people].filter(([, p]) => p.receiver).map(([id, p]) => [id, p.receiver])),
    epoch: session.epoch,
  }
}

// ---------- Connection health ----------

function applyViewerBuffer(pc) {
  for (const receiver of pc?.getReceivers() || []) {
    if ('jitterBufferTarget' in receiver && receiver.jitterBufferTarget !== session.buffer.bufferMs) {
      receiver.jitterBufferTarget = session.buffer.bufferMs
    }
  }
}

// Every couple of seconds: measure the connection to everyone in the room. Viewers also adapt
// their buffer and report what they're receiving so the host can see it.
async function sampleConnection() {
  const room = session.room
  if (!room) return
  const pcs = room.getPeers()
  const readings = new Map(
    await Promise.all(Object.entries(pcs).map(async ([id, pc]) => [id, await pc.getStats().then(readStats, () => null)])),
  )
  if (session.room !== room) return
  for (const [id, stats] of readings) {
    if (stats && session.peers.has(id)) Object.assign(person(id), {rttMs: stats.rttMs, relayed: stats.relayed})
  }

  const peerId = session.role === 'viewer' ? session.hostId : [...session.peers][0]
  const stats = readings.get(peerId)
  if (!stats) {
    session.link = null
    return render()
  }
  const pc = pcs[peerId]
  const base = {rttMs: stats.rttMs, relayed: stats.relayed}

  if (isHost()) {
    session.link = {...session.link, ...base, sender: stats.outbound}
  } else if (session.role === 'viewer' && stats.inbound) {
    // Packet loss is always the network; freezes and jitter only count during steady playback.
    const steady = isSteady(session.steady, performance.now())
    const measured = inboundDelta(session.lastInbound, stats.inbound)
    const delta = measured && !steady ? {...measured, freezes: 0, droppedFrames: 0} : measured
    session.lastInbound = stats.inbound
    if (measured?.delayMs != null) session.playoutDelayMs = measured.delayMs
    session.buffer = adaptBuffer(session.buffer, isTroubled(delta, steady ? stats.inbound.jitterMs : 0), TELEMETRY_INTERVAL_MS)
    applyViewerBuffer(pc)
    const receiver = {
      lossPct: delta?.lossPct ?? 0,
      freezes: delta?.freezes ?? 0,
      droppedFrames: delta?.droppedFrames ?? 0,
      fps: stats.inbound.fps,
      height: stats.inbound.height,
      bufferMs: session.buffer.bufferMs,
    }
    session.link = {...base, receiver, sender: session.remote?.sender || null}
    session.telemetryAction.send(receiver, {target: session.hostId}).catch(() => {})
  } else {
    session.link = base
  }
  render()
}

function broadcastState(target) {
  if (session.role !== 'host' || !session.stateAction) return
  session.stateAction.send(hostState(), target ? {target} : undefined).catch(() => {})
  render()
}

function applyCommand(cmd, value) {
  if (!player.loaded) return
  const video = ui.localVideo
  if (cmd === 'play') video.play().catch(() => {})
  else if (cmd === 'pause') video.pause()
  else if (cmd === 'seek') player.seek(Number(value))
  else if (cmd === 'audio') player.setAudio(value === '' ? null : Number(value))
  else if (cmd === 'subtitle' && (!value || player.media.subtitles.some((s) => s.id === value && s.image))) player.setSubtitle(value || null)
  broadcastState()
}

// ---------- Watching ----------

function receiveState(state, peerId) {
  if (session.role === 'host') {
    if (!isNewerClaim(state, {hostId: selfId, claimedAt: session.claimedAt})) {
      broadcastState(peerId) // they'll see our newer claim and step down
      return
    }
    stopHosting()
    toast('Your friend is hosting now')
  }
  const now = performance.now()
  session.steady = nextSteady(session.steady, state, session.remote ? viewerTime() : state.time, now)
  session.hostId = state.hostId
  session.remote = {...state, receivedAt: now}
  for (const [id, receiver] of Object.entries(state.viewers || {})) {
    if (session.peers.has(id)) person(id).receiver = receiver
  }
  if (session.role !== 'viewer') setRole('viewer')
  attachRemoteStream()
  render()
}

function attachRemoteStream() {
  if (session.role !== 'viewer') return
  const stream = session.peerStreams.get(session.hostId)
  if (stream && ui.remoteVideo.srcObject !== stream) {
    ui.remoteVideo.srcObject = stream
    ui.remoteVideo.play().catch(() => {})
  }
}

function viewerTime() {
  const r = session.remote
  if (!r) return 0
  const elapsed = r.playing && !r.buffering ? (performance.now() - r.receivedAt) / 1000 : 0
  return Math.min(r.time + elapsed, r.duration || Infinity)
}

// ---------- People ----------

const MAX_NAME_LENGTH = 40
let myName = 'Me'
const myProfile = () => ({name: myName})

function person(peerId) {
  if (!session.people.has(peerId)) session.people.set(peerId, {name: null, rttMs: null, relayed: false, receiver: null})
  return session.people.get(peerId)
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function renderPeople() {
  const host = isHost()
  const hostId = host ? selfId : session.hostId
  const me = {id: selfId, self: true, name: myName, ...(host ? {sender: session.link?.sender} : {receiver: session.role === 'viewer' ? session.link?.receiver : null})}
  const others = [...session.peers].map((id) => {
    const p = person(id)
    return {id, name: p.name, rttMs: p.rttMs, relayed: p.relayed, receiver: p.receiver, sender: id === hostId ? session.remote?.sender : null}
  })
  const rows = [me, ...others]
    .map((row) => ({...row, host: row.id === hostId, stats: describePeer(row)}))
    .sort((a, b) => b.host - a.host)

  ui.peopleCount.textContent = String(rows.length)
  const signature = JSON.stringify(rows.map(({name, self, host, stats}) => [name, self, host, stats]))
  if (ui.people.dataset.signature === signature) return
  ui.people.dataset.signature = signature
  ui.people.replaceChildren(
    ...rows.map(({name, self, host, stats}) => {
      const shownName = name || 'Joining…'
      const row = element('li', 'person')
      if (stats.level) row.dataset.level = stats.level
      const nameLine = element('div', 'person-name', shownName)
      if (self) nameLine.append(element('span', 'person-tag', 'you'))
      const statsLine = element('div', 'person-stats', [host ? 'Hosting' : null, stats.text].filter(Boolean).join(' · ') || ' ')
      if (stats.detail) statsLine.title = stats.detail
      const main = element('div', 'person-main')
      main.append(nameLine, statsLine)
      row.append(element('span', 'avatar', shownName.trim()[0]?.toUpperCase() || '?'), main)
      return row
    }),
  )
}

function setPeopleOpen(open) {
  ui.room.classList.toggle('people-open', open)
  try {
    localStorage.setItem('peopleOpen', open ? '1' : '0')
  } catch {}
}

// ---------- Whiteboard ----------
// Everyone in the room draws on one board over the video. Showing it is a personal choice; the
// strokes keep arriving either way.

const tools = {pen: true, color: COLORS[0], size: 1}
let drawing = null // {stroke, sent} while this person is drawing
let strokeCount = 0
let boardLayout = null // what the canvas was last fully drawn for

const boardOpen = () => ui.room.classList.contains('board-open')

function currentPictureRect() {
  const video = isHost() ? ui.localVideo : ui.remoteVideo
  const playing = session.role !== 'idle'
  return pictureRect(ui.stage.clientWidth, ui.stage.clientHeight, playing ? video.videoWidth : 0, playing ? video.videoHeight : 0)
}

function boardContext() {
  const ctx = ui.board.getContext('2d')
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0)
  return ctx
}

// Redraw everything when the window, the picture or the board itself changed since last time.
function syncBoardLayout(force = false) {
  const dpr = window.devicePixelRatio || 1
  const width = Math.round(ui.stage.clientWidth * dpr)
  const height = Math.round(ui.stage.clientHeight * dpr)
  const rect = currentPictureRect()
  const layout = {board: session.board, key: JSON.stringify([width, height, rect])}
  if (!force && boardLayout?.board === layout.board && boardLayout.key === layout.key) return
  boardLayout = layout
  if (ui.board.width !== width || ui.board.height !== height) Object.assign(ui.board, {width, height})
  const ctx = boardContext()
  ctx.clearRect(0, 0, ui.stage.clientWidth, ui.stage.clientHeight)
  for (const stroke of session.board.strokes.values()) drawStroke(ctx, stroke, rect)
}

function receiveBoard(message, peerId) {
  if (message?.type === 'stroke') {
    const stroke = addStrokeChunk(session.board, message)
    if (!stroke) return
    drawStroke(boardContext(), stroke, currentPictureRect(), message.offset)
    if (!boardOpen()) ui.boardToggle.classList.add('activity')
  } else if (message?.type === 'clear') {
    clearBoard(session.board, message.at)
    syncBoardLayout(true)
    toast(`${person(peerId).name || 'Someone'} cleared the board`)
  } else if (message?.type === 'sync') {
    mergeSnapshot(session.board, message)
    syncBoardLayout(true)
  }
}

function boardPoints(event) {
  const box = ui.stage.getBoundingClientRect()
  const rect = currentPictureRect()
  const events = event.getCoalescedEvents?.() || []
  return (events.length ? events : [event]).flatMap((e) => [
    Math.round(((e.clientX - box.left - rect.x) / rect.width) * 10000) / 10000,
    Math.round(((e.clientY - box.top - rect.y) / rect.height) * 10000) / 10000,
  ])
}

function sendStroke() {
  if (!drawing || !session.boardAction) return
  const {stroke, sent} = drawing
  if (stroke.points.length <= sent) return
  const {id, color, size, at} = stroke
  session.boardAction.send({type: 'stroke', id, color, size, at, offset: sent, points: stroke.points.slice(sent)}).catch(() => {})
  drawing.sent = stroke.points.length
}

function endStroke() {
  sendStroke()
  drawing = null
}

function clearBoardForEveryone() {
  // Cover strokes stamped by a clock slightly ahead of ours, too.
  const at = Math.max(Date.now(), ...[...session.board.strokes.values()].map((s) => s.at))
  clearBoard(session.board, at)
  session.boardAction?.send({type: 'clear', at}).catch(() => {})
  syncBoardLayout(true)
}

function setBoardOpen(open) {
  ui.room.classList.toggle('board-open', open)
  if (open) ui.boardToggle.classList.remove('activity')
  renderTools()
}

function renderTools() {
  ui.room.classList.toggle('pen', tools.pen && boardOpen())
  ui.pen.classList.toggle('active', tools.pen)
  for (const swatch of ui.swatches.children) swatch.classList.toggle('active', swatch.dataset.color === tools.color)
  for (const size of ui.sizes.children) size.classList.toggle('active', Number(size.dataset.size) === tools.size)
}

// ---------- Subtitles ----------
// Text subtitles are drawn by each person's own app, so everyone picks their own track (or none).
// Image subtitles (PGS, VobSub) can only be burned into the stream, so they show for everyone.

function hostCues(id) {
  if (!isHost() || !player.media?.subtitles.some((s) => s.id === id && !s.image)) throw new Error('Subtitle track not found')
  return window.api.subtitleCues({filePath: player.media.filePath, subtitleId: id})
}

function loadCues(id) {
  if (id.startsWith(LOCAL_SUBTITLE)) return window.api.subtitleCues({subtitleId: `external:${id.slice(LOCAL_SUBTITLE.length)}`})
  if (isHost()) return hostCues(id)
  return session.cuesAction.request({id}, {target: session.hostId, timeoutMs: CUES_TIMEOUT_MS})
}

async function selectSubtitle(id) {
  const token = Symbol('captions')
  session.captions = {...session.captions, id: id || null, cues: [], token}
  if (!id) return
  const captions = session.captions
  const slow = setTimeout(() => toast('Loading subtitles…'), 400)
  try {
    const cues = await loadCues(id)
    if (captions.token === token) captions.cues = cues
  } catch (err) {
    if (captions.token !== token) return
    Object.assign(captions, {id: null, token: null})
    toast(`Couldn't load subtitles: ${errorMessage(err)}`, true)
  } finally {
    clearTimeout(slow)
  }
}

// A new video starts everyone on its default text track, if it has one.
function syncCaptionsToMedia(state) {
  const key = state && !state.loading ? `${state.hostId}:${state.claimedAt}` : null
  if (key === session.captions.mediaKey) return
  session.captions.mediaKey = key
  session.localSubtitles = []
  selectSubtitle(state?.subtitles?.find((s) => s.isDefault && !s.image)?.value)
}

function addSubtitleFile(filePath) {
  if (session.role === 'idle') return toast('Open a video first')
  if (isHost()) return selectSubtitle(player.addExternalSubtitle(filePath))
  const value = `${LOCAL_SUBTITLE}${filePath}`
  if (!session.localSubtitles.some((s) => s.value === value)) {
    session.localSubtitles.push({value, label: filePath.split(/[\\/]/).pop()})
  }
  selectSubtitle(value)
}

// The viewer's picture trails the host's clock by the jitter buffer, so captions wait for it.
let captionsShown = ''
function drawCaptions() {
  requestAnimationFrame(drawCaptions)
  const {cues} = session.captions
  const delayMs = isHost() ? 0 : (session.playoutDelayMs ?? session.buffer.bufferMs) + DECODE_DELAY_MS
  const html = cues.length && session.role !== 'idle' ? captionHtml(cues, currentTime() - delayMs / 1000) : ''
  if (html !== captionsShown) ui.captions.innerHTML = captionsShown = html
}

// ---------- Shared controls ----------

const isHost = () => session.role === 'host'
const currentTime = () => (isHost() ? ui.localVideo.currentTime : viewerTime())
const currentDuration = () => (isHost() ? player.duration : session.remote?.duration || 0)
const isPlaying = () => (isHost() ? !ui.localVideo.paused : Boolean(session.remote?.playing))

function control(cmd, value) {
  if (isHost()) return applyCommand(cmd, value)
  const r = session.remote
  if (session.role !== 'viewer' || !r) return
  session.commandAction.send({cmd, value}, {target: session.hostId}).catch(() => {})
  session.steady = {...session.steady, since: null}
  // Reflect the change immediately; the host's next state message confirms it.
  const now = performance.now()
  if (cmd === 'play' || cmd === 'pause') Object.assign(r, {time: viewerTime(), playing: cmd === 'play', receivedAt: now})
  else if (cmd === 'seek') Object.assign(r, {time: Number(value), receivedAt: now})
  else if (cmd === 'audio') r.audioSelected = value
  else if (cmd === 'subtitle') r.subtitleSelected = value
  render()
}

const togglePlay = () => control(isPlaying() ? 'pause' : 'play')

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else ui.room.requestFullscreen().catch(() => {})
}

function fillSelect(select, options, selected) {
  const signature = JSON.stringify(options)
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...options.map((o) => new Option(o.label, o.value)))
    select.dataset.signature = signature
  }
  if (document.activeElement !== select) select.value = selected
}

function render() {
  const role = session.role
  const host = role === 'host'
  const r = session.remote
  const ready = host ? player.loaded : Boolean(r && !r.loading)
  const duration = currentDuration()
  const time = currentTime()

  const peerCount = session.peers.size
  ui.peerStatus.textContent = peerCount ? 'Friend connected' : 'Waiting for your friend to join…'
  ui.peerStatus.classList.toggle('connected', peerCount > 0)
  renderPeople()
  syncBoardLayout()
  const health = peerCount && session.link ? describeLink({selfRole: role, ...session.link}) : null
  ui.link.hidden = !health
  if (health) {
    ui.link.textContent = health.text
    ui.link.title = health.detail
    ui.link.dataset.level = health.level
  }
  // Problems show as a faint caution sign on the video; hover it for the explanation.
  const problem = health && health.level !== 'good'
  ui.linkWarning.hidden = !problem
  if (problem) ui.linkWarningTip.textContent = health.detail
  ui.title.textContent = host ? player.media?.title || player.media?.name || '' : r?.title || ''
  const converting = (host ? player.transcoding : r?.transcoding) ? ' · converting' : ''
  ui.role.textContent = {host: `Hosting${converting}`, viewer: `Watching${converting}`, idle: ''}[role]

  ui.stage.classList.toggle('waiting', role === 'viewer' && !ready)
  ui.emptyText.textContent =
    role === 'viewer' ? 'Your friend is opening a video…' : 'Drop a video here, or open one to host it.'
  const stalled = host ? player.loaded && !ui.localVideo.paused && ui.localVideo.readyState < 3 : role === 'viewer' && (r?.buffering || (ready && ui.remoteVideo.readyState < 2))
  ui.spinner.hidden = !stalled

  ui.controls.classList.toggle('disabled', !ready)
  ui.play.dataset.state = isPlaying() ? 'playing' : 'paused'
  ui.time.textContent = formatTime(time)
  ui.duration.textContent = formatTime(duration)
  if (!session.seeking) ui.seek.value = duration ? String(Math.round((time / duration) * 1000)) : '0'

  const state = host ? hostState() : r
  const audio = state?.audio || []
  fillSelect(ui.audio, audio, state?.audioSelected ?? '')
  ui.audio.hidden = audio.length <= 1
  syncCaptionsToMedia(role === 'idle' ? null : state)
  const subtitles = [
    {value: '', label: 'Subtitles off'},
    ...(state?.subtitles || []).map((s) => ({value: s.value, label: s.image ? `${s.label} · for everyone` : s.label})),
    ...session.localSubtitles,
  ]
  if (ready) subtitles.push({value: LOAD_SUBTITLE, label: 'Load subtitle file…'})
  fillSelect(ui.subtitles, subtitles, session.captions.id ?? state?.subtitleSelected ?? '')
  ui.subtitles.hidden = subtitles.length <= 1

  if (!isPlaying()) ui.room.classList.remove('idle')
  else if (!chromeTimer && !ui.room.classList.contains('idle')) wakeChrome()
}

let toastTimer = null
function toast(message, isError = false) {
  ui.toast.textContent = message
  ui.toast.classList.toggle('error', isError)
  ui.toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (ui.toast.hidden = true), isError ? 7000 : 2500)
}

// ---------- Wiring ----------

ui.create.addEventListener('click', () => enterRoom(generateRoomCode()))

ui.joinForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const code = normalizeRoomCode(ui.joinCode.value)
  const valid = code.length === 8
  ui.joinCode.classList.toggle('invalid', !valid)
  if (valid) enterRoom(code)
})

ui.code.addEventListener('click', async () => {
  await navigator.clipboard.writeText(formatRoomCode(session.code)).catch(() => {})
  toast('Room code copied')
})

ui.leave.addEventListener('click', leaveRoom)

ui.boardToggle.addEventListener('click', () => setBoardOpen(!boardOpen()))
ui.pen.addEventListener('click', () => {
  tools.pen = !tools.pen
  renderTools()
})
for (const color of COLORS) {
  const swatch = element('button', 'swatch')
  swatch.dataset.color = color
  swatch.style.background = color
  swatch.title = 'Pen colour'
  swatch.addEventListener('click', () => {
    Object.assign(tools, {color, pen: true})
    renderTools()
  })
  ui.swatches.append(swatch)
}
BRUSH_SIZES.forEach((_, size) => {
  const button = element('button', 'size')
  button.dataset.size = String(size)
  button.title = ['Thin', 'Medium', 'Thick', 'Marker'][size]
  const dot = element('span')
  dot.style.width = dot.style.height = `${[4, 7, 11, 16][size]}px`
  button.append(dot)
  button.addEventListener('click', () => {
    Object.assign(tools, {size, pen: true})
    renderTools()
  })
  ui.sizes.append(button)
})
ui.boardClear.addEventListener('click', clearBoardForEveryone)
renderTools()

ui.board.addEventListener('pointerdown', (event) => {
  if (!tools.pen || event.button !== 0 || !session.room) return
  ui.board.setPointerCapture(event.pointerId)
  const id = `${selfId}:${Date.now().toString(36)}:${strokeCount++}`
  const stroke = addStrokeChunk(session.board, {id, color: tools.color, size: tools.size, at: Date.now(), points: boardPoints(event).slice(0, 2)})
  drawing = stroke && {stroke, sent: 0}
  if (stroke) drawStroke(boardContext(), stroke, currentPictureRect())
})
ui.board.addEventListener('pointermove', (event) => {
  if (!drawing) return
  const {stroke} = drawing
  const from = stroke.points.length
  if (!addStrokeChunk(session.board, {...stroke, offset: from, points: boardPoints(event)})) return (drawing = null)
  drawStroke(boardContext(), stroke, currentPictureRect(), from)
})
ui.board.addEventListener('pointerup', endStroke)
ui.board.addEventListener('pointercancel', endStroke)
window.addEventListener('resize', () => syncBoardLayout())

ui.peopleToggle.addEventListener('click', () => setPeopleOpen(!ui.room.classList.contains('people-open')))
try {
  setPeopleOpen(localStorage.getItem('peopleOpen') !== '0')
} catch {
  setPeopleOpen(true)
}

window.api.userName().then((name) => {
  if (name) myName = name.slice(0, MAX_NAME_LENGTH)
  session.profileAction?.send(myProfile()).catch(() => {})
})

for (const button of ui.openButtons) {
  button.addEventListener('click', async () => {
    const filePath = await window.api.chooseVideo()
    if (filePath) hostFile(filePath)
  })
}

ui.play.addEventListener('click', togglePlay)
ui.localVideo.addEventListener('click', togglePlay)
ui.remoteVideo.addEventListener('click', togglePlay)
ui.stage.addEventListener('dblclick', (event) => {
  if (event.target instanceof HTMLVideoElement) toggleFullscreen()
})
ui.fullscreen.addEventListener('click', toggleFullscreen)

ui.seek.addEventListener('input', () => {
  session.seeking = true
  ui.time.textContent = formatTime((ui.seek.value / 1000) * currentDuration())
})
ui.seek.addEventListener('change', () => {
  session.seeking = false
  control('seek', (ui.seek.value / 1000) * currentDuration())
})

ui.audio.addEventListener('change', () => control('audio', ui.audio.value))

ui.subtitles.addEventListener('change', async () => {
  const value = ui.subtitles.value
  const state = isHost() ? hostState() : session.remote
  if (value === LOAD_SUBTITLE) {
    ui.subtitles.value = session.captions.id ?? state?.subtitleSelected ?? ''
    const filePath = await window.api.chooseSubtitle()
    if (filePath) addSubtitleFile(filePath)
    return
  }
  const image = Boolean(state?.subtitles?.some((s) => s.value === value && s.image))
  // Burned-in subtitles are shared, so only touch them when picking one or turning subtitles off.
  if (image || (!value && state?.subtitleSelected)) control('subtitle', value)
  selectSubtitle(image ? null : value)
})

function setVolume(volume) {
  ui.localVideo.volume = ui.remoteVideo.volume = volume
  ui.volume.value = String(volume)
  try {
    localStorage.setItem('volume', String(volume))
  } catch {}
}
ui.volume.addEventListener('input', () => setVolume(Number(ui.volume.value)))
try {
  const saved = localStorage.getItem('volume')
  if (saved != null) setVolume(Number(saved))
} catch {}

for (const type of ['play', 'pause', 'seeked', 'waiting', 'playing']) {
  ui.localVideo.addEventListener(type, () => broadcastState())
}
// A new MediaSource means new tracks, so the captured stream has to be republished.
ui.localVideo.addEventListener('loadedmetadata', () => {
  if (isHost()) publishStream()
})

player.addEventListener('media', () => broadcastState())
player.addEventListener('session', () => {
  session.epoch++
  broadcastState()
})
player.addEventListener('loading', () => render())
player.addEventListener('error', ({detail}) => toast(detail, true))

document.addEventListener('keydown', (event) => {
  if (ui.room.hidden || event.target.matches('input:not([type=range]), select, textarea')) return
  if (event.code === 'Space') {
    event.preventDefault()
    if (event.target instanceof HTMLButtonElement) event.target.blur()
    togglePlay()
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault()
    control('seek', currentTime() + (event.code === 'ArrowLeft' ? -10 : 10))
  } else if (event.code === 'KeyF') {
    toggleFullscreen()
  } else if (event.code === 'KeyM') {
    setVolume(Number(ui.volume.value) > 0 ? 0 : 1)
  }
})

// While a video plays, the top bar, sidebar and controls get out of the way until the mouse moves.
let chromeTimer = null
const chromeInUse = () =>
  Boolean(drawing || ui.room.querySelector('.topbar:hover, .controls:hover, .sidebar:hover, .board-tools:hover, select:focus'))
function wakeChrome() {
  ui.room.classList.remove('idle')
  clearTimeout(chromeTimer)
  chromeTimer = setTimeout(() => {
    chromeTimer = null
    if (!isPlaying()) return
    if (chromeInUse()) wakeChrome()
    else ui.room.classList.add('idle')
  }, CHROME_IDLE_MS)
}
ui.room.addEventListener('mousemove', wakeChrome)
document.documentElement.addEventListener('mouseleave', () => {
  if (isPlaying() && !chromeInUse()) ui.room.classList.add('idle')
})

// Keep Electron from navigating to files dropped outside the stage.
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => event.preventDefault())
ui.stage.addEventListener('dragover', () => ui.stage.classList.add('dragging'))
ui.stage.addEventListener('dragleave', (event) => {
  if (!ui.stage.contains(event.relatedTarget)) ui.stage.classList.remove('dragging')
})
ui.stage.addEventListener('drop', (event) => {
  ui.stage.classList.remove('dragging')
  const file = event.dataTransfer.files[0]
  if (!file) return
  const filePath = window.api.pathForFile(file)
  if (!SUBTITLE_FILE.test(filePath)) return hostFile(filePath)
  addSubtitleFile(filePath)
})

window.addEventListener('beforeunload', () => session.room?.leave())

setInterval(render, 250)
requestAnimationFrame(drawCaptions)
setInterval(sendStroke, 50)
setInterval(() => sampleConnection().catch(() => {}), TELEMETRY_INTERVAL_MS)
setInterval(() => {
  if (!isHost()) return
  broadcastState()
  tuneSenders()
}, STATE_INTERVAL_MS)
