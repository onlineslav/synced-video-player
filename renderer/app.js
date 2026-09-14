import {joinRoom, selfId} from 'trystero'
import {
  errorMessage,
  formatRoomCode,
  formatTime,
  generateRoomCode,
  isImageMime,
  isImagePath,
  isNewerClaim,
  MAX_IMAGE_BYTES,
  normalizeRoomCode,
  preferHighStartBitrate,
  preferStereoOpus,
} from './lib.mjs'
import {captureVideoFrames} from './frames.mjs'
import {StreamPlayer} from './player.mjs'
import {FriendNetwork, presenceText} from './friends.mjs'
import {HANDLE_HINT, createIdentity, createKeys, isValidIdentity, normalizeHandle, normalizeUsername, usernameFor} from './identity.mjs'
import {cleanDisplayName} from './profile.mjs'
import {drawConfetti, launchConfetti, stepConfetti} from './confetti.mjs'
import {REACTIONS, createRateLimiter, playReactionSound} from './reactions.mjs'
import {captionHtml} from './subtitles.mjs'
import {
  DRAWER,
  addItem,
  createPlaylist,
  draggedWidth,
  maxDrawerWidth,
  mergePlaylist,
  nextItem,
  orderedItems,
  playlistSnapshot,
  clampDrag,
  dropIndex,
  slotShift,
  endPosition,
  moveItem,
  positionAt,
  removeItem,
  settledWidth,
} from './playlist.mjs'
import {averageLuminance, sourceRegion, toneFor} from './overlay.mjs'
import {
  BRUSH_SIZES,
  COLORS,
  addStrokeChunk,
  boardSnapshot,
  clearBoard,
  createBoard,
  drawStroke,
  ERASER,
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
  welcome: $('welcome'),
  welcomeForm: $('welcome-form'),
  welcomeTitle: $('welcome-title'),
  welcomeLede: $('welcome-lede'),
  handle: $('handle'),
  handleTag: $('handle-tag'),
  handleHint: $('handle-hint'),
  welcomeName: $('welcome-name'),
  welcomeSubmit: $('welcome-submit'),
  welcomeCancel: $('welcome-cancel'),
  home: $('home'),
  profileAvatar: $('profile-avatar'),
  profileName: $('profile-name'),
  username: $('username'),
  newUsername: $('new-username'),
  openSettings: $('open-settings'),
  roomSettings: $('room-settings'),
  friendsToggles: document.querySelectorAll('.friends-toggle'),
  friends: $('friends'),
  homeInvites: $('home-invites'),
  inviteFriends: $('invite-friends'),
  pinButtons: document.querySelectorAll('[data-pin]'),
  settings: $('settings'),
  settingsUsername: $('settings-username'),
  settingsBack: $('settings-back'),
  addFriend: $('add-friend'),
  friendUsername: $('friend-username'),
  friendError: $('friend-error'),
  friendRequests: $('friend-requests'),
  friendList: $('friend-list'),
  friendsEmpty: $('friends-empty'),
  joinRequests: $('join-requests'),
  reactions: $('reactions'),
  reactionsToggle: $('reactions-toggle'),
  reactionFeed: $('reaction-feed'),
  confetti: $('confetti'),
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
  eraser: $('eraser'),
  playlist: $('playlist'),
  playlistTab: $('playlist-tab'),
  playlistEdge: $('playlist-edge'),
  playlistAdd: $('playlist-add'),
  playlistItems: $('playlist-items'),
  playlistEmpty: $('playlist-empty'),
  openButtons: document.querySelectorAll('[data-open-media]'),
  audioOnly: $('audio-only'),
  audioOnlyTitle: $('audio-only-title'),
  leave: $('leave'),
  stage: $('stage'),
  localVideo: $('local-video'),
  remoteVideo: $('remote-video'),
  picture: $('picture'),
  captions: $('captions'),
  emptyText: $('empty-text'),
  spinner: $('spinner'),
  toast: $('toast'),
  controls: $('controls'),
  play: $('play'),
  loop: $('loop'),
  time: $('time'),
  seek: $('seek'),
  duration: $('duration'),
  audio: $('audio-select'),
  subtitles: $('subtitle-select'),
  volume: $('volume'),
  volumeControl: $('volume-control'),
  volumeReadout: $('volume-readout'),
  mute: $('mute'),
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
  reactAction: null,
  role: 'idle', // 'idle' | 'host' | 'viewer'
  hostId: null,
  claimedAt: 0,
  loop: false, // shared: the host restarts the video when it ends, and whoever hosts next keeps it
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
  imageAction: null,
  image: null, // host: the picture being shown {id, name, mime, bytes, url}
  images: new Map(), // peerId -> {id, url}: the last picture each host sent
  imageProgress: null, // viewer: {id, percent} while a picture is arriving
  playlistAction: null,
  playlist: createPlaylist(),
  playing: null, // host: the playlist item being hosted {id, at}, so the next one can follow it
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
    reactAction: room.makeAction('react'),
    imageAction: room.makeAction('image'),
    playlistAction: room.makeAction('playlist'),
  }
  session.playlistAction.onMessage = (message, {peerId}) => receivePlaylist(message, peerId)
  session.imageAction.onMessage = (bytes, {peerId, metadata}) => receiveImage(bytes, peerId, metadata)
  // Arrives per 16KB chunk, so it's only stored; the regular render picks it up.
  session.imageAction.onReceiveProgress = (percent, {peerId, metadata}) => {
    if (peerId === session.hostId && typeof metadata?.id === 'string') session.imageProgress = {id: metadata.id, percent}
  }
  session.reactAction.onMessage = (message, {peerId}) => receiveReaction(message?.kind, peerId)
  session.cuesAction.onRequest = ({id}) => hostCues(id)
  session.boardAction.onMessage = (message, {peerId}) => receiveBoard(message, peerId)
  session.profileAction.onMessage = (profile, {peerId}) => {
    if (!session.peers.has(peerId)) return
    person(peerId).name = cleanDisplayName(profile?.name)
    person(peerId).username = normalizeUsername(profile?.username)
    render()
  }

  room.onPeerJoin = (peerId) => {
    session.peers.add(peerId)
    session.profileAction.send(myProfile(), {target: peerId}).catch(() => {})
    if (session.board.strokes.size) session.boardAction.send({type: 'sync', ...boardSnapshot(session.board)}, {target: peerId}).catch(() => {})
    if (session.playlist.items.size || session.playlist.removed.size) {
      session.playlistAction.send({type: 'sync', ...playlistSnapshot(session.playlist)}, {target: peerId}).catch(() => {})
    }
    toast('Friend connected')
    if (session.role === 'host') {
      if (session.stream) Promise.all(room.addStream(session.stream, {target: peerId})).then(tuneSenders, () => {})
      if (session.image) sendImage(peerId)
      broadcastState(peerId)
    }
    render()
  }

  room.onPeerLeave = (peerId) => {
    session.peers.delete(peerId)
    session.peerStreams.delete(peerId)
    session.people.delete(peerId)
    forgetImage(peerId)
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

  window.api.setInRoom(true)
  ui.code.textContent = formatRoomCode(code)
  ui.home.hidden = ui.settings.hidden = true
  ui.room.hidden = false
  ui.room.append(ui.friends)
  setFriendsOpen(false)
  renderFriends() // friends get Invite buttons
  setRole('idle')
}

async function leaveRoom() {
  const room = session.room
  player.close()
  unpublishStream()
  ui.remoteVideo.srcObject = null
  ui.joinRequests.replaceChildren()
  ui.reactionFeed.replaceChildren()
  clearHostImage()
  for (const peerId of [...session.images.keys()]) forgetImage(peerId)
  session = blankSession()
  setRole('idle')
  ui.room.hidden = ui.settings.hidden = true
  ui.home.hidden = false
  ui.home.append(ui.friends)
  setFriendsOpen(false)
  renderFriends()
  await room?.leave()
  window.api.setInRoom(false) // a downloaded update installs now
}

function setRole(role) {
  session.role = role
  ui.stage.dataset.role = role
  render()
}

// ---------- Hosting ----------

// `item` is the playlist item this file was started from, if any.
async function hostFile(filePath, item = null) {
  if (!session.room) return
  const claimedAt = (session.claimedAt = Date.now())
  session.playing = item && {id: item.id, position: item.position}
  session.hostId = selfId
  session.remote = null
  ui.remoteVideo.srcObject = null
  clearHostImage()
  setRole('host')
  broadcastState()
  if (isImagePath(filePath)) return hostImage(filePath, claimedAt)
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
  clearHostImage()
  session.playing = null
  setRole('idle')
}

const hostedTitle = () => session.image?.name || player.media?.title || player.media?.name || null

// ---------- Pictures ----------
// A picture isn't streamed: the host sends the file itself, so everyone sees it at full resolution.

async function hostImage(filePath, claimedAt) {
  player.close()
  unpublishStream()
  try {
    const {name, mime, bytes} = await window.api.readImage(filePath)
    if (session.claimedAt !== claimedAt || !isHost()) return
    const url = URL.createObjectURL(new Blob([bytes], {type: mime}))
    session.image = {id: String(claimedAt), name, mime, bytes, url}
    sendImage()
  } catch (err) {
    if (session.claimedAt !== claimedAt || !isHost()) return
    toast(errorMessage(err), true)
    stopHosting()
  }
  broadcastState()
}

function sendImage(target) {
  const {id, name, mime, bytes} = session.image
  session.imageAction.send(bytes, {metadata: {id, name, mime}, ...(target && {target})}).catch(() => {})
}

function clearHostImage() {
  if (session.image) URL.revokeObjectURL(session.image.url)
  session.image = null
}

// Kept per sender until they send another, so a picture that arrives before its state still shows.
function receiveImage(bytes, peerId, metadata) {
  const {id, mime} = metadata || {}
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMAGE_BYTES || typeof id !== 'string' || !isImageMime(mime)) return
  forgetImage(peerId)
  session.images.set(peerId, {id, url: URL.createObjectURL(new Blob([bytes], {type: mime}))})
  render()
}

function forgetImage(peerId) {
  const image = session.images.get(peerId)
  if (image) URL.revokeObjectURL(image.url)
  session.images.delete(peerId)
}

// The host's own picture, or the one the host sent if it's the one their state names.
function shownImage() {
  if (isHost()) return session.image
  const wanted = session.remote?.image?.id
  const received = wanted && session.images.get(session.hostId)
  return received && received.id === wanted ? received : null
}

function showPicture(url) {
  if ((ui.picture.getAttribute('src') || null) === url) return
  if (url) ui.picture.src = url
  else ui.picture.removeAttribute('src')
  ui.picture.hidden = !url
}

// Video comes from captureVideoFrames (true source frame rate); captureStream supplies audio,
// and video too if the frame APIs are unavailable. Audio files get no video track: one that never
// receives a frame can hold the viewer's <video> below HAVE_CURRENT_DATA, so it never plays.
function publishStream() {
  unpublishStream()
  const video = ui.localVideo
  const captured = video.captureStream()
  const frames = player.media?.video ? captureVideoFrames(video) : null
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
    title: hostedTitle(),
    loading: !media && !session.image,
    image: session.image ? {id: session.image.id} : null,
    playlistId: session.playing?.id || null,
    audioOnly: Boolean(media && !media.video),
    playing: hostPlaying(),
    buffering: hostPlaying() && video.readyState < 3,
    time: video.currentTime,
    duration: player.duration,
    loop: session.loop,
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
  if (cmd === 'loop') session.loop = Boolean(value)
  else if (cmd === 'play') video.play().catch(() => {})
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
  session.loop = Boolean(state.loop)
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
    routeRemoteAudio(stream)
    stream.onaddtrack = () => {
      if (ui.remoteVideo.srcObject === stream) routeRemoteAudio(stream)
    }
    ui.remoteVideo.play().catch(() => {})
  }
}

function viewerTime() {
  const r = session.remote
  if (!r) return 0
  const elapsed = r.playing && !r.buffering ? (performance.now() - r.receivedAt) / 1000 : 0
  return Math.min(r.time + elapsed, r.duration || Infinity)
}

// ---------- Profile ----------

const DEFAULT_NAME = 'Karlie Chirp' // the display name when the welcome screen's name is left empty
let myName = DEFAULT_NAME
let identity = null // {username, publicKey, privateKey}
const myProfile = () => ({name: myName, username: identity?.username || null, status: myStatus()})

// Friends see whether you're in a room, and what you're hosting.
function myStatus() {
  const hosting = session.role === 'host' && (player.loaded || Boolean(session.image))
  return {inRoom: Boolean(session.room), hosting, title: hosting ? hostedTitle() : null}
}

let sharedStatus = ''
function syncPresence() {
  const status = JSON.stringify(myStatus())
  if (!friendNetwork.identity || status === sharedStatus) return
  sharedStatus = status
  friendNetwork.updateProfile(myProfile())
  renderFriends() // "Ask to join" only shows while you're not in a room
}

async function loadIdentity() {
  try {
    const stored = JSON.parse(localStorage.getItem('identity'))
    if (await isValidIdentity(stored)) return stored
  } catch {}
  return null
}

function saveIdentity(next) {
  try {
    localStorage.setItem('identity', JSON.stringify(next))
  } catch {}
  return next
}

function renderProfile() {
  if (document.activeElement !== ui.profileName) ui.profileName.value = myName
  ui.profileAvatar.textContent = myName.trim()[0]?.toUpperCase() || '?'
  ui.username.textContent = ui.settingsUsername.textContent = identity?.username || '…'
}

// The display name is what people see; the username stays the same when it changes.
function setMyName(input) {
  const name = cleanDisplayName(input)
  if (name && name !== myName) {
    myName = name
    try {
      localStorage.setItem('displayName', name)
    } catch {}
  }
  shareProfile()
  render()
}

function bindNameInput(input) {
  input.addEventListener('change', () => {
    setMyName(input.value)
    // Show the name as saved: cleaned up, or the previous one if this was blank.
    input.value = myName
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') input.value = myName
    if (event.key === 'Enter' || event.key === 'Escape') input.blur()
  })
}

function shareProfile() {
  renderProfile()
  session.profileAction?.send(myProfile()).catch(() => {})
  if (friendNetwork.identity) friendNetwork.updateProfile(myProfile())
}

// ---------- Welcome ----------
// The first screen on a new install: pick a username and a display name. After that the username
// can only be changed from Settings, which comes back here.

let welcome = null // {mode: 'first' | 'change', keys} while the screen is open

async function showWelcome(mode) {
  const changing = mode === 'change'
  welcome = {mode, keys: await createKeys()}
  ui.welcomeTitle.textContent = changing ? 'Change your username' : 'Welcome'
  ui.welcomeLede.textContent = changing
    ? 'Friends who added you will have to add you again.'
    : 'Pick a username friends can add you by, and the name people see.'
  ui.handle.value = changing ? identity.handle : ''
  ui.welcomeName.value = changing ? myName : ''
  ui.welcomeCancel.hidden = !changing
  ui.home.hidden = ui.settings.hidden = true
  ui.welcome.hidden = false
  ui.handle.focus()
  updateWelcome()
}

async function updateWelcome() {
  const current = welcome
  const handle = normalizeHandle(ui.handle.value)
  const typed = ui.handle.value.trim() !== ''
  ui.welcomeSubmit.disabled = !(current && handle)
  ui.handleHint.textContent = typed && !handle ? `Usernames are ${HANDLE_HINT}` : 'The tag after # is added for you, so the username is yours alone.'
  ui.handleHint.classList.toggle('invalid', typed && !handle)
  const username = current && handle ? await usernameFor(current.keys.publicKey, handle) : null
  if (welcome !== current || normalizeHandle(ui.handle.value) !== handle) return
  ui.handleTag.textContent = username ? `#${username.split('#')[1]}` : '#····-····'
}

function finishWelcome(next, mode) {
  identity = next
  welcome = null
  ui.welcome.hidden = true
  // A changed username goes back to Settings, where it was changed from.
  ui.home.hidden = false
  showSettings(mode === 'change')
  delete ui.username.dataset.original
  if (mode === 'change') friendNetwork.restart(identity)
  else friendNetwork.start(identity, myProfile())
  shareProfile()
}

// ---------- Friends ----------

const localStore = {
  load(key) {
    try {
      return JSON.parse(localStorage.getItem(key))
    } catch {
      return null
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  },
}

const friendNetwork = new FriendNetwork({joinRoom, selfId, appId: APP_ID, storage: localStore})

const presenceOf = (friend) => {
  if (!friend.confirmed) return 'pending'
  if (!friend.online) return 'offline'
  return friend.status?.hosting ? 'hosting' : friend.status?.inRoom ? 'room' : 'online'
}
const PRESENCE_ORDER = ['hosting', 'room', 'online', 'offline', 'pending']

function renderFriends() {
  const requests = friendNetwork.requestList()
  const label = (friend) => friend.name || friend.username
  const friends = friendNetwork
    .list()
    .sort((a, b) => PRESENCE_ORDER.indexOf(presenceOf(a)) - PRESENCE_ORDER.indexOf(presenceOf(b)) || label(a).localeCompare(label(b)))

  ui.friendRequests.replaceChildren(
    ...requests.map(({username, name}) => {
      const row = element('li', 'friend friend-request')
      const main = element('div', 'person-main')
      main.append(element('div', 'person-name', name || username), element('div', 'person-stats', 'Wants to be friends'))
      main.lastChild.title = `Username: ${username}`
      const accept = element('button', 'primary small', 'Add back')
      accept.addEventListener('click', () => friendNetwork.add(username))
      const ignore = element('button', 'ghost small', 'Ignore')
      ignore.addEventListener('click', () => friendNetwork.ignoreRequest(username))
      const actions = element('div', 'friend-actions')
      actions.append(accept, ignore)
      row.append(element('span', 'avatar', (name || username)[0].toUpperCase()), main, actions)
      return row
    }),
  )

  ui.friendList.replaceChildren(
    ...friends.map((friend) => {
      const label = friend.name || friend.username
      const row = element('li', 'friend')
      row.dataset.presence = presenceOf(friend)
      const main = element('div', 'person-main')
      main.append(element('div', 'person-name', label), element('div', 'person-stats', presenceText(friend)))
      main.firstChild.title = `Username: ${friend.username}`
      const remove = element('button', 'friend-remove', '×')
      remove.title = 'Remove friend'
      remove.setAttribute('aria-label', `Remove ${label}`)
      remove.addEventListener('click', () => {
        if (confirm(`Remove ${label} from your friends?`)) friendNetwork.remove(friend.username)
      })
      row.append(element('span', 'avatar', label[0].toUpperCase()), main)
      if (friend.online && session.room) {
        const invite = element('button', 'small friend-ask', friend.invited ? 'Invited' : 'Invite')
        invite.disabled = friend.invited
        invite.addEventListener('click', () => showFriendNotice(friendNetwork.inviteToRoom(friend.username, session.code)))
        row.append(invite)
      } else if (friend.online && friend.status?.inRoom) {
        const ask = element('button', 'small friend-ask', friend.asked ? 'Asked…' : 'Ask to join')
        ask.disabled = friend.asked
        ask.addEventListener('click', () => showFriendNotice(friendNetwork.askToJoin(friend.username)))
        row.append(ask)
      }
      row.append(remove)
      return row
    }),
  )
  ui.friendsEmpty.hidden = friends.length + requests.length > 0
  const online = friends.some((friend) => !['offline', 'pending'].includes(presenceOf(friend)))
  for (const toggle of ui.friendsToggles) toggle.dataset.dot = requests.length ? 'request' : online ? 'online' : ''
}

function showFriendNotice(message, {error = true} = {}) {
  ui.friendError.textContent = message || ''
  ui.friendError.hidden = !message
  ui.friendError.classList.toggle('notice', !error)
}

// A friend asks to join: you can only let them into a room you're in.
function receiveJoinAsk({username, name}) {
  if (!session.room) return friendNetwork.answerJoin(username, null)
  if ([...ui.joinRequests.children].some((card) => card.dataset.username === username)) return
  const card = element('div', 'join-request')
  card.dataset.username = username
  const answer = (code) => {
    card.remove()
    friendNetwork.answerJoin(username, code)
  }
  const letIn = element('button', 'primary small', 'Let in')
  letIn.addEventListener('click', () => answer(session.code))
  const notNow = element('button', 'ghost small', 'Not now')
  notNow.addEventListener('click', () => answer(null))
  card.append(element('span', null, `${name} wants to join`), letIn, notNow)
  ui.joinRequests.append(card)
  setTimeout(() => card.remove(), 120_000)
}

async function joinFriendRoom(name, code, leaveQuestion) {
  const roomCode = normalizeRoomCode(code)
  if (roomCode.length !== 8 || session.code === roomCode) return
  if (session.room) {
    if (!confirm(leaveQuestion)) return
    await leaveRoom()
  }
  showFriendNotice(null)
  await enterRoom(roomCode)
  toast(`Joined ${name}'s room`)
}

const receiveJoinInvite = ({name, code}) => joinFriendRoom(name, code, `${name} let you in. Leave this room and join theirs?`)

// A friend invites you into their room. It's only a card: nothing happens unless you click Join.
function receiveJoinOffer({username, name, code}) {
  if (session.code === normalizeRoomCode(code)) return
  const holder = ui.room.hidden ? ui.homeInvites : ui.joinRequests
  if ([...holder.children].some((card) => card.dataset.offerFrom === username)) return
  const card = element('div', 'join-request')
  card.dataset.offerFrom = username
  const join = element('button', 'primary small', 'Join')
  join.addEventListener('click', () => {
    card.remove()
    joinFriendRoom(name, code, `Leave this room and join ${name}'s?`)
  })
  const notNow = element('button', 'ghost small', 'Not now')
  notNow.addEventListener('click', () => card.remove())
  card.append(element('span', null, `${name} invited you to their room`), join, notNow)
  holder.append(card)
  setTimeout(() => card.remove(), 120_000)
}

// ---------- People ----------

function person(peerId) {
  if (!session.people.has(peerId)) session.people.set(peerId, {name: null, username: null, rttMs: null, relayed: false, receiver: null})
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
  const me = {id: selfId, self: true, name: myName, username: identity?.username, ...(host ? {sender: session.link?.sender} : {receiver: session.role === 'viewer' ? session.link?.receiver : null})}
  const others = [...session.peers].map((id) => {
    const p = person(id)
    return {id, name: p.name, username: p.username, rttMs: p.rttMs, relayed: p.relayed, receiver: p.receiver, sender: id === hostId ? session.remote?.sender : null}
  })
  const rows = [me, ...others]
    .map((row) => ({...row, host: row.id === hostId, stats: describePeer(row)}))
    .sort((a, b) => b.host - a.host)

  ui.peopleCount.textContent = String(rows.length)
  const signature = JSON.stringify(rows.map(({name, username, self, host, stats}) => [name, username, self, host, stats]))
  if (ui.people.dataset.signature === signature) return
  ui.people.dataset.signature = signature
  ui.people.replaceChildren(
    ...rows.map(({name, username, self, host, stats}) => {
      const shownName = name || 'Joining…'
      const row = element('li', 'person')
      if (stats.level) row.dataset.level = stats.level
      // Your own name is changed in Settings, not here.
      const nameLine = element('div', 'person-name', shownName)
      if (username) nameLine.title = `Username: ${username}`
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

const tools = {tool: 'pen', color: COLORS[0], size: 1} // tool: 'pen', 'eraser' or null
let drawing = null // {stroke, sent} while this person is drawing
let strokeCount = 0
let boardLayout = null // what the canvas was last fully drawn for

const boardOpen = () => ui.room.classList.contains('board-open')

function currentPictureRect() {
  const {picture} = ui
  if (shownImage() && picture.complete && picture.naturalWidth) {
    return pictureRect(ui.stage.clientWidth, ui.stage.clientHeight, picture.naturalWidth, picture.naturalHeight)
  }
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
  ui.room.classList.toggle('pen', Boolean(tools.tool) && boardOpen())
  ui.pen.classList.toggle('active', tools.tool === 'pen')
  ui.eraser.classList.toggle('active', tools.tool === 'eraser')
  for (const swatch of ui.swatches.children) swatch.classList.toggle('active', swatch.dataset.color === tools.color)
  for (const size of ui.sizes.children) size.classList.toggle('active', Number(size.dataset.size) === tools.size)
}

// ---------- Playlist ----------
// Anyone adds files from their own computer. A file never leaves its owner's app: playing an item
// asks the owner to host it, and when it ends the host starts the next one it can.

const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>'
const ownFiles = new Map() // playlist item id -> file path, for items this app added
let itemCount = 0

function addToPlaylist(filePaths) {
  if (!session.room) return
  let added = 0
  for (const filePath of filePaths.filter((p) => p && !SUBTITLE_FILE.test(p))) {
    const id = `${selfId}:${Date.now().toString(36)}:${itemCount++}`
    const message = {id, title: filePath.split(/[\\/]/).pop(), position: endPosition(session.playlist), ownerName: myName}
    if (!addItem(session.playlist, message, selfId)) continue
    ownFiles.set(message.id, filePath)
    session.playlistAction.send({type: 'add', ...message}).catch(() => {})
    added++
  }
  if (added) toast(added === 1 ? 'Added to the playlist' : `Added ${added} files to the playlist`)
  render()
}

function removeFromPlaylist(id) {
  removeItem(session.playlist, id)
  ownFiles.delete(id)
  session.playlistAction?.send({type: 'remove', id}).catch(() => {})
  render()
}

// Moves item `id` to `index` among the other items, for everyone.
function moveInPlaylist(id, index) {
  const item = session.playlist.items.get(id)
  const position = item && positionAt(session.playlist, id, index)
  if (position == null) return
  // Stamped after the item's last move, so it wins even if that came from a clock running ahead.
  const move = {id, position, movedAt: Math.max(Date.now(), item.movedAt + 1), movedBy: selfId}
  if (moveItem(session.playlist, move)) session.playlistAction?.send({type: 'move', ...move}).catch(() => {})
  render()
}

function receivePlaylist(message, peerId) {
  if (message?.type === 'add') addItem(session.playlist, message, peerId)
  else if (message?.type === 'remove') {
    removeItem(session.playlist, message.id)
    ownFiles.delete(message.id)
  } else if (message?.type === 'move') moveItem(session.playlist, {...message, movedBy: peerId})
  else if (message?.type === 'sync') mergePlaylist(session.playlist, message)
  else if (message?.type === 'play') playItem(message.id, peerId)
  render()
}

const playable = (item) => (item.owner === selfId ? ownFiles.has(item.id) : session.peers.has(item.owner))
const ownerName = (item) => (item.owner === selfId ? 'you' : session.people.get(item.owner)?.name || item.ownerName || 'Someone')

// Plays an item for everyone. `from` is the peer who asked, when the request came from someone else.
function playItem(id, from = null) {
  const item = session.playlist.items.get(id)
  if (!item) return
  if (item.owner === selfId) {
    const filePath = ownFiles.get(id)
    if (filePath) hostFile(filePath, item)
  } else if (from == null) {
    // Only the owner's app has the file, so it hosts; nobody relays requests for someone else's.
    if (!session.peers.has(item.owner)) return toast(`${ownerName(item)} left, so that can't play`, true)
    session.playlistAction.send({type: 'play', id}, {target: item.owner}).catch(() => {})
  }
}

function playNext() {
  const next = nextItem(session.playlist, session.playing, playable)
  if (next) playItem(next.id)
}

function renderPlaylist() {
  const items = orderedItems(session.playlist)
  const current = isHost() ? session.playing?.id : session.remote?.playlistId
  ui.playlistEmpty.hidden = items.length > 0
  const rows = items.map((item) => ({item, current: item.id === current, available: playable(item), owner: ownerName(item)}))
  const signature = JSON.stringify(rows.map(({item, current, available, owner}) => [item.id, item.title, current, available, owner]))
  // Don't rebuild the rows under someone dragging one; the list catches up when they let go.
  if (ui.playlistItems.dataset.signature === signature || itemDrag) return
  ui.playlistItems.dataset.signature = signature
  ui.playlistItems.replaceChildren(
    ...rows.map(({item, current, available, owner}) => {
      const row = element('li', 'playlist-item')
      row.dataset.id = item.id
      row.title = 'Drag to reorder'
      row.classList.toggle('current', current)
      row.classList.toggle('missing', !available)
      const play = element('button', 'playlist-play')
      play.innerHTML = PLAY_ICON
      play.disabled = !available
      play.title = available ? 'Play for everyone' : `${owner} isn't in the room`
      play.setAttribute('aria-label', `Play ${item.title}`)
      play.addEventListener('click', () => playItem(item.id))
      const main = element('div', 'person-main')
      const status = !available ? `${owner} left, so this can't play` : `${current ? 'Playing · ' : ''}Added by ${owner}`
      main.append(element('div', 'person-name', item.title), element('div', 'person-stats', status))
      main.firstChild.title = item.title
      const remove = element('button', 'playlist-remove', '×')
      remove.title = 'Remove for everyone'
      remove.setAttribute('aria-label', `Remove ${item.title}`)
      remove.addEventListener('click', () => removeFromPlaylist(item.id))
      row.addEventListener('dblclick', (event) => {
        if (available && !event.target.closest('button')) playItem(item.id)
      })
      row.append(play, main, remove)
      return row
    }),
  )
}

// The drawer: click the tab to open or close it, or drag the tab or the open panel's left edge to
// pull it out to any width or push it closed.
let playlistWidth = DRAWER.defaultWidth // the width it opens at
let tabDrag = null // {startX, startWidth, width} while the tab or edge is held
let tabDragged = false // the click that follows a drag shouldn't also toggle

const playlistOpen = () => ui.room.classList.contains('playlist-open')
const fittedPlaylistWidth = () => Math.min(playlistWidth, maxDrawerWidth(innerWidth))

function showPlaylistWidth(width) {
  ui.room.style.setProperty('--playlist-width', `${width}px`)
  ui.room.classList.toggle('playlist-open', width > 0)
  ui.playlistTab.setAttribute('aria-expanded', String(width > 0))
}

function setPlaylistOpen(open) {
  showPlaylistWidth(open ? fittedPlaylistWidth() : 0)
  try {
    localStorage.setItem('playlist', JSON.stringify({open, width: playlistWidth}))
  } catch {}
}

function endTabDrag() {
  const drag = tabDrag
  tabDrag = null
  ui.room.classList.remove('resizing')
  tabDragged = drag?.width != null
  if (!tabDragged) return
  const width = settledWidth(drag.width, maxDrawerWidth(innerWidth))
  if (width) playlistWidth = width
  setPlaylistOpen(width > 0)
}

// The tab turns black over bright pictures: a few times a second, read the pixels behind it.
const toneCanvas = Object.assign(document.createElement('canvas'), {width: 4, height: 12})
const toneContext = toneCanvas.getContext('2d', {willReadFrequently: true})
let tabTone = 'light'

// What's showing on the stage, with its own pixel size; null for a blank or audio-only stage.
function visibleSource() {
  if (shownImage()) {
    const {picture} = ui
    return picture.complete && picture.naturalWidth ? {element: picture, width: picture.naturalWidth, height: picture.naturalHeight} : null
  }
  if (session.role === 'idle') return null
  const video = isHost() ? ui.localVideo : ui.remoteVideo
  return video.videoWidth && video.readyState >= 2 ? {element: video, width: video.videoWidth, height: video.videoHeight} : null
}

function sampleTabTone() {
  if (ui.room.hidden || ui.room.classList.contains('idle')) return
  const stage = ui.stage.getBoundingClientRect()
  const tab = ui.playlistTab.querySelector('svg').getBoundingClientRect() // the chevron, not its large hit area
  const target = {x: tab.left - stage.left, y: tab.top - stage.top, width: tab.width, height: tab.height}
  const source = visibleSource()
  const rect = source && pictureRect(stage.width, stage.height, source.width, source.height)
  const region = source && sourceRegion(target, rect, source.width, source.height)
  let luminance = 0
  if (region) {
    try {
      toneContext.clearRect(0, 0, toneCanvas.width, toneCanvas.height)
      toneContext.drawImage(source.element, region.sx, region.sy, region.sw, region.sh, 0, 0, toneCanvas.width, toneCanvas.height)
      luminance = averageLuminance(toneContext.getImageData(0, 0, toneCanvas.width, toneCanvas.height).data)
    } catch {}
  }
  tabTone = toneFor(luminance, tabTone)
  if (ui.playlistTab.dataset.tone !== tabTone) ui.playlistTab.dataset.tone = tabTone
}

// ---------- Reactions ----------
// Air horn, golf clap, quack and confetti: everyone in the room sees who sent one and hears it.

const REACTION_SHOWN_MS = 2600
const allowReaction = createRateLimiter()
let audio = null
let confetti = []
let confettiFrame = null
let confettiTime = 0

function react(kind) {
  if (!session.room || !REACTIONS[kind] || !allowReaction(selfId, performance.now())) return
  session.reactAction.send({kind}).catch(() => {})
  showReaction(kind, myName)
}

function receiveReaction(kind, peerId) {
  if (!REACTIONS[kind] || !session.peers.has(peerId) || !allowReaction(peerId, performance.now())) return
  showReaction(kind, person(peerId).name || 'Someone')
}

function showReaction(kind, name) {
  const {emoji, label} = REACTIONS[kind]
  const bubble = element('div', 'reaction-bubble')
  bubble.title = label
  bubble.append(element('span', 'reaction-emoji', emoji), element('span', null, name))
  ui.reactionFeed.append(bubble)
  setTimeout(() => bubble.remove(), REACTION_SHOWN_MS)
  playReaction(kind)
  if (kind === 'confetti') startConfetti()
}

// Reactions follow the app's volume, so muting silences them too.
function playReaction(kind) {
  const volume = Number(ui.volume.value)
  if (!volume) return
  try {
    const out = audioOutput()
    const gain = audio.createGain()
    gain.connect(out)
    playReactionSound(audio, gain, kind)
    setTimeout(() => gain.disconnect(), 3000)
  } catch {}
}

function startConfetti() {
  const dpr = window.devicePixelRatio || 1
  Object.assign(ui.confetti, {width: Math.round(innerWidth * dpr), height: Math.round(innerHeight * dpr)})
  confetti.push(...launchConfetti(innerWidth, innerHeight))
  ui.confetti.hidden = false
  if (confettiFrame != null) return
  confettiTime = performance.now()
  confettiFrame = requestAnimationFrame(animateConfetti)
}

function animateConfetti(now) {
  const dt = Math.min(0.05, Math.max(0, now - confettiTime) / 1000)
  confettiTime = now
  confetti = stepConfetti(confetti, dt, innerHeight)
  const ctx = ui.confetti.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, innerWidth, innerHeight)
  drawConfetti(ctx, confetti)
  if (confetti.length) {
    confettiFrame = requestAnimationFrame(animateConfetti)
  } else {
    confettiFrame = null
    ui.confetti.hidden = true
  }
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
  if (session.role === 'idle') return toast('Open media first')
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
// A video that reaches its end is paused just before 'ended' fires. With loop on it restarts
// straight away, so that moment still counts as playing: the UI stays hidden and viewers never see a pause.
const hostPlaying = () => !ui.localVideo.paused || (session.loop && ui.localVideo.ended)
const isPlaying = () => (isHost() ? hostPlaying() : Boolean(session.remote?.playing))

function control(cmd, value) {
  if (isHost() ? session.image : session.remote?.image) return // a picture has nothing to play
  if (isHost()) return applyCommand(cmd, value)
  const r = session.remote
  if (session.role !== 'viewer' || !r) return
  session.commandAction.send({cmd, value}, {target: session.hostId}).catch(() => {})
  session.steady = {...session.steady, since: null}
  // Reflect the change immediately; the host's next state message confirms it.
  const now = performance.now()
  if (cmd === 'play' || cmd === 'pause') Object.assign(r, {time: viewerTime(), playing: cmd === 'play', receivedAt: now})
  else if (cmd === 'seek') Object.assign(r, {time: Number(value), receivedAt: now})
  else if (cmd === 'loop') session.loop = Boolean(value)
  else if (cmd === 'audio') r.audioSelected = value
  else if (cmd === 'subtitle') r.subtitleSelected = value
  render()
}

const togglePlay = () => control(isPlaying() ? 'pause' : 'play')
const toggleLoop = () => control('loop', !session.loop)

// Plex-style skips: 10 seconds back, 30 forward. The arrow keys do the same.
function skip(seconds) {
  const duration = currentDuration()
  const target = Math.max(0, currentTime() + seconds)
  control('seek', duration ? Math.min(target, duration) : target)
}

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
  const ready = host ? player.loaded || Boolean(session.image) : Boolean(r && !r.loading)
  const duration = currentDuration()
  const time = currentTime()

  const peerCount = session.peers.size
  ui.peerStatus.textContent = peerCount ? 'Friend connected' : 'Waiting for your friend to join…'
  ui.peerStatus.classList.toggle('connected', peerCount > 0)
  renderPeople()
  renderPlaylist()
  sampleTabTone()
  syncBoardLayout()
  syncPresence()
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
  ui.title.textContent = (host ? hostedTitle() : r?.title) || ''
  const converting = (host ? player.transcoding : r?.transcoding) ? ' · converting' : ''
  ui.role.textContent = {host: `Hosting${converting}`, viewer: `Watching${converting}`, idle: ''}[role]

  const image = shownImage()
  const imageMode = Boolean(host ? session.image : r?.image)
  const receivingImage = role === 'viewer' && imageMode && !image
  ui.stage.classList.toggle('showing-image', imageMode)
  showPicture(image?.url || null)

  ui.stage.classList.toggle('waiting', role === 'viewer' && (!ready || receivingImage))
  const progress = receivingImage && session.imageProgress?.id === r.image.id ? session.imageProgress.percent : 0
  ui.emptyText.textContent = receivingImage
    ? `Receiving the picture… ${Math.round(progress * 100)}%`
    : role === 'viewer'
      ? 'Your friend is opening something…'
      : 'Drop a video, song or picture here, or open one to host it.'
  const audioOnly = ready && (host ? Boolean(player.media && !player.media.video) : Boolean(r?.audioOnly))
  ui.audioOnly.hidden = !audioOnly
  if (audioOnly) ui.audioOnlyTitle.textContent = ui.title.textContent
  const stalled = host ? player.loaded && hostPlaying() && ui.localVideo.readyState < 3 : role === 'viewer' && (r?.buffering || (ready && ui.remoteVideo.readyState < 2))
  ui.spinner.hidden = !stalled

  ui.controls.classList.toggle('disabled', !ready)
  // A picture has nothing to play, seek or loop (control ignores them), so say so.
  ui.play.disabled = ui.loop.disabled = ui.seek.disabled = imageMode
  ui.play.dataset.state = isPlaying() ? 'playing' : 'paused'
  ui.loop.classList.toggle('active', session.loop)
  ui.loop.setAttribute('aria-pressed', String(session.loop))
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
  // With no tracks there's nothing to pick; dropping a subtitle file on the stage adds one.
  ui.subtitles.hidden = subtitles.length <= 1
  if (ready) subtitles.push({value: LOAD_SUBTITLE, label: 'Load subtitle file…'})
  fillSelect(ui.subtitles, subtitles, session.captions.id ?? state?.subtitleSelected ?? '')

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
for (const [button, tool] of [[ui.pen, 'pen'], [ui.eraser, 'eraser']]) {
  button.addEventListener('click', () => {
    tools.tool = tools.tool === tool ? null : tool
    renderTools()
  })
}
for (const color of COLORS) {
  const swatch = element('button', 'swatch')
  swatch.dataset.color = color
  swatch.style.background = color
  swatch.title = 'Pen colour'
  swatch.addEventListener('click', () => {
    Object.assign(tools, {color, tool: 'pen'})
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
    // Sizes apply to the eraser too, so picking one keeps it selected.
    Object.assign(tools, {size, tool: tools.tool || 'pen'})
    renderTools()
  })
  ui.sizes.append(button)
})
ui.boardClear.addEventListener('click', clearBoardForEveryone)
renderTools()

ui.board.addEventListener('pointerdown', (event) => {
  if (!tools.tool || event.button !== 0 || !session.room) return
  ui.board.setPointerCapture(event.pointerId)
  const id = `${selfId}:${Date.now().toString(36)}:${strokeCount++}`
  const color = tools.tool === 'eraser' ? ERASER : tools.color
  const stroke = addStrokeChunk(session.board, {id, color, size: tools.size, at: Date.now(), points: boardPoints(event).slice(0, 2)})
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

for (const handle of [ui.playlistTab, ui.playlistEdge]) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault() // no text selection while dragging the edge
    handle.setPointerCapture(event.pointerId)
    tabDragged = false
    tabDrag = {startX: event.clientX, startWidth: playlistOpen() ? fittedPlaylistWidth() : 0, width: null}
  })
  handle.addEventListener('pointermove', (event) => {
    if (!tabDrag) return
    const dx = event.clientX - tabDrag.startX
    if (tabDrag.width == null && Math.abs(dx) < 4) return // still a click
    ui.room.classList.add('resizing')
    tabDrag.width = draggedWidth(tabDrag.startWidth, dx, maxDrawerWidth(innerWidth))
    showPlaylistWidth(tabDrag.width)
  })
  handle.addEventListener('pointerup', endTabDrag)
  handle.addEventListener('pointercancel', endTabDrag)
}
ui.playlistTab.addEventListener('click', () => {
  if (tabDragged) tabDragged = false
  else setPlaylistOpen(!playlistOpen())
})
window.addEventListener('resize', () => {
  if (playlistOpen() && !tabDrag) showPlaylistWidth(fittedPlaylistWidth())
})
try {
  const saved = JSON.parse(localStorage.getItem('playlist'))
  if (Number.isFinite(saved?.width)) playlistWidth = Math.min(DRAWER.maxWidth, Math.max(DRAWER.minWidth, saved.width))
  setPlaylistOpen(Boolean(saved?.open))
} catch {
  setPlaylistOpen(false)
}

ui.playlistAdd.addEventListener('click', async () => addToPlaylist(await window.api.chooseMediaFiles()))

// Reordering, like Spotify: hold a row and drag it. It follows the pointer (kept inside the list), the
// rows it passes slide aside to open a gap where it will land, and near the top or bottom edge the
// list scrolls. On release it glides into the gap, then the list is reordered for everyone.
const SETTLE_MS = 170
let itemDrag = null // {id, row, rows, tops, from, to, startY, startScroll, y, lifted, settling} while a row is held

function updateItemDrag() {
  const {row, rows, tops, from, startY, startScroll, y} = itemDrag
  const dy = clampDrag(tops, from, y - startY + ui.playlistItems.scrollTop - startScroll)
  const to = dropIndex(tops, from, dy)
  row.style.transform = `translateY(${dy}px)`
  if (to === itemDrag.to) return
  itemDrag.to = to
  rows.forEach((r, i) => {
    if (r !== row) r.style.transform = `translateY(${slotShift(tops, i, from, to)}px)`
  })
}

function scrollItemDrag() {
  if (!itemDrag?.lifted || itemDrag.settling) return
  const box = ui.playlistItems.getBoundingClientRect()
  const edge = 40
  const over = itemDrag.y < box.top + edge ? itemDrag.y - box.top - edge : itemDrag.y > box.bottom - edge ? itemDrag.y - box.bottom + edge : 0
  if (over) {
    ui.playlistItems.scrollTop += Math.max(-14, Math.min(14, over / 3))
    updateItemDrag()
  }
  requestAnimationFrame(scrollItemDrag)
}

function endItemDrag(commit) {
  const drag = itemDrag
  if (!drag || drag.settling) return
  if (!drag.lifted) return void (itemDrag = null)
  drag.settling = true
  const to = commit ? drag.to : drag.from
  drag.row.classList.add('settling')
  drag.row.style.transform = `translateY(${drag.tops[to] - drag.tops[drag.from]}px)`
  if (!commit) drag.rows.forEach((r) => r !== drag.row && (r.style.transform = ''))
  setTimeout(() => {
    itemDrag = null
    // Without the reordering class the rows lose their transition, so clearing the shifts is
    // instant and the rebuilt list appears exactly where the rows already are.
    ui.playlist.classList.remove('reordering')
    for (const r of drag.rows) {
      r.classList.remove('lifted', 'settling')
      r.style.transform = ''
    }
    if (commit) moveInPlaylist(drag.id, to)
    render()
  }, SETTLE_MS)
}

ui.playlistItems.addEventListener('pointerdown', (event) => {
  const row = event.target.closest('.playlist-item')
  if (itemDrag || !row || event.button !== 0 || event.target.closest('button')) return
  row.setPointerCapture(event.pointerId)
  const rows = [...ui.playlistItems.children]
  const from = rows.indexOf(row)
  const tops = rows.map((r) => r.offsetTop)
  const start = {startY: event.clientY, startScroll: ui.playlistItems.scrollTop, y: event.clientY}
  itemDrag = {id: row.dataset.id, row, rows, tops, from, to: from, ...start, lifted: false, settling: false}
})
ui.playlistItems.addEventListener('pointermove', (event) => {
  if (!itemDrag || itemDrag.settling) return
  itemDrag.y = event.clientY
  if (!itemDrag.lifted) {
    if (Math.abs(event.clientY - itemDrag.startY) < 4) return // still a click
    itemDrag.lifted = true
    itemDrag.row.classList.add('lifted')
    ui.playlist.classList.add('reordering')
    requestAnimationFrame(scrollItemDrag)
  }
  updateItemDrag()
})
ui.playlistItems.addEventListener('pointerup', () => endItemDrag(true))
ui.playlistItems.addEventListener('pointercancel', () => endItemDrag(false))
ui.playlistItems.addEventListener('lostpointercapture', () => endItemDrag(false))
// Dropping files on the playlist, or on its tab while it's closed, adds them all.
ui.playlist.addEventListener('dragover', (event) => {
  event.preventDefault()
  ui.playlist.classList.add('dropping')
  if (!playlistOpen()) setPlaylistOpen(true)
})
ui.playlist.addEventListener('dragleave', (event) => {
  if (!ui.playlist.contains(event.relatedTarget)) ui.playlist.classList.remove('dropping')
})
ui.playlist.addEventListener('drop', (event) => {
  event.preventDefault()
  ui.playlist.classList.remove('dropping')
  addToPlaylist([...event.dataTransfer.files].map((file) => window.api.pathForFile(file)).filter(Boolean))
})

// The display name picked on the welcome screen, or changed since.
let savedName = null
try {
  savedName = cleanDisplayName(localStorage.getItem('displayName'))
} catch {}
if (savedName) myName = savedName
bindNameInput(ui.profileName)

// A new install, or an identity from before usernames had handles, starts on the welcome screen.
Promise.all([loadIdentity(), window.api.iceServers().catch(() => [])]).then(
  ([loaded, turnConfig]) => {
    friendNetwork.turnConfig = turnConfig
    if (loaded && savedName) finishWelcome(loaded, 'first')
    else showWelcome('first')
  },
)

// Mac can't install updates itself, so home shows a card when a newer release is out.
window.api.checkForUpdate().then((update) => {
  if (!update) return
  const card = element('div', 'join-request')
  const label = element('span', null, `Version ${update.version} is out`)
  const download = element('button', 'primary small', 'Download')
  const steps = element('button', 'small', 'Install steps')
  const close = element('button', 'ghost small', 'Not now')
  download.addEventListener('click', () => {
    window.api.openUpdate('download')
    label.textContent = 'Open the download and drag the app into Applications'
    download.replaceWith(steps)
    close.textContent = 'Done'
  })
  steps.addEventListener('click', () => window.api.openUpdate('page'))
  close.addEventListener('click', () => card.remove())
  card.append(label, download, close)
  ui.homeInvites.append(card)
}, () => {})

ui.handle.addEventListener('input', updateWelcome)
ui.welcomeName.addEventListener('input', updateWelcome)
ui.welcomeCancel.addEventListener('click', () => {
  welcome = null
  ui.welcome.hidden = true
  ui.home.hidden = false
  showSettings(true)
})
ui.welcomeForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const handle = normalizeHandle(ui.handle.value)
  const name = cleanDisplayName(ui.welcomeName.value) || DEFAULT_NAME
  const current = welcome
  if (!current || !handle) return
  ui.welcomeSubmit.disabled = true
  const next = saveIdentity(await createIdentity(handle, current.keys))
  myName = name
  try {
    localStorage.setItem('displayName', name)
  } catch {}
  finishWelcome(next, current.mode)
})

friendNetwork.addEventListener('change', renderFriends)
friendNetwork.addEventListener('join-ask', ({detail}) => receiveJoinAsk(detail))
friendNetwork.addEventListener('join-invite', ({detail}) => receiveJoinInvite(detail))
friendNetwork.addEventListener('join-offer', ({detail}) => receiveJoinOffer(detail))
friendNetwork.addEventListener('join-declined', ({detail}) => showFriendNotice(`${detail.name} can't let you in right now.`, {error: false}))
renderFriends()

ui.addFriend.addEventListener('submit', (event) => {
  event.preventDefault()
  const error = identity ? friendNetwork.add(ui.friendUsername.value) : 'Still starting up, try again in a moment.'
  showFriendNotice(error)
  if (!error) ui.friendUsername.value = ''
})

// Home has no toast, so buttons confirm by briefly changing their own text.
function flashButton(button, text) {
  const original = button.dataset.original ?? button.textContent
  button.dataset.original = original
  button.textContent = text
  clearTimeout(Number(button.dataset.timer))
  button.dataset.timer = String(setTimeout(() => (button.textContent = original), 1500))
}

ui.username.addEventListener('click', async () => {
  if (!identity) return
  const copied = await navigator.clipboard.writeText(identity.username).then(() => true, () => false)
  flashButton(ui.username, copied ? 'Copied' : "Couldn't copy")
})

// Settings opens over the current screen. In a room it goes inside the room so it shows in fullscreen,
// and changing your username waits until you leave, because the welcome screen takes the whole window.
function showSettings(open) {
  if (open) {
    const inRoom = !ui.room.hidden
    const parent = inRoom ? ui.room : document.body
    parent.append(ui.settings)
    ui.newUsername.disabled = inRoom
    ui.newUsername.title = inRoom ? 'Leave the room to change your username' : ''
  }
  ui.settings.hidden = !open
}

ui.openSettings.addEventListener('click', () => showSettings(true))
ui.roomSettings.addEventListener('click', () => showSettings(true))
ui.settingsBack.addEventListener('click', () => showSettings(false))
// Clicking the dimmed backdrop closes it, but a text selection that ends there doesn't.
let backdropPress = false
ui.settings.addEventListener('pointerdown', (event) => (backdropPress = event.target === ui.settings))
ui.settings.addEventListener('click', (event) => {
  if (backdropPress && event.target === ui.settings) showSettings(false)
})

// One friends list: it slides in from the left on home, and floats over the video on the left in a
// room. enterRoom and leaveRoom move it between the two.
function setFriendsOpen(open) {
  for (const screen of [ui.home, ui.room]) screen.classList.toggle('friends-open', open)
  for (const toggle of ui.friendsToggles) toggle.setAttribute('aria-expanded', String(open))
}
for (const toggle of ui.friendsToggles) {
  toggle.addEventListener('click', () => setFriendsOpen(!ui.home.classList.contains('friends-open')))
}
ui.inviteFriends.addEventListener('click', () => setFriendsOpen(true))

// Pinned keeps the window above other apps. Home (bottom right) and the player controls each have a button,
// so you can always unpin from wherever you are.
let pinned = false
async function setPinned(next) {
  pinned = await window.api.setPinned(next).catch(() => pinned)
  for (const button of ui.pinButtons) {
    button.setAttribute('aria-pressed', String(pinned))
    button.title = pinned ? 'Unpin: stop staying on top' : 'Pin: stay on top of other windows'
  }
}
for (const button of ui.pinButtons) button.addEventListener('click', () => setPinned(!pinned))
ui.newUsername.addEventListener('click', () => showWelcome('change'))

for (const button of ui.openButtons) {
  button.addEventListener('click', async () => {
    const filePath = await window.api.chooseMedia()
    if (filePath) hostFile(filePath)
  })
}

ui.play.addEventListener('click', togglePlay)
for (const button of document.querySelectorAll('[data-skip]')) {
  button.addEventListener('click', () => skip(Number(button.dataset.skip)))
}
ui.loop.addEventListener('click', toggleLoop)
ui.localVideo.addEventListener('click', togglePlay)
ui.remoteVideo.addEventListener('click', togglePlay)
ui.stage.addEventListener('dblclick', (event) => {
  if (event.target instanceof HTMLVideoElement || event.target === ui.picture) toggleFullscreen()
})
ui.picture.addEventListener('load', () => render()) // the whiteboard lines up once its size is known
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

// Unmuting goes back to the last volume the person chose. Only a released slider counts, so dragging
// down to 0 doesn't remember the tiny value it passed on the way.
let unmutedVolume = 1

// Everything the app plays goes through one gain, because a <video>'s own volume stops at 100%.
// The host's element is routed into Web Audio; Chromium still hands captureStream the audio before
// that routing, so viewers don't hear the host's volume. The viewer's element is muted and its
// WebRTC audio is taken straight from the stream (Chromium plays remote WebRTC audio through Web
// Audio only while the stream is also attached to an element, which remoteVideo is).
let output = null
let remoteAudio = null

function audioOutput() {
  if (!output) {
    audio ??= new AudioContext()
    output = audio.createGain()
    output.gain.value = Number(ui.volume.value)
    output.connect(audio.destination)
    audio.createMediaElementSource(ui.localVideo).connect(output)
    ui.remoteVideo.muted = true
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {})
  return output
}

function routeRemoteAudio(stream) {
  remoteAudio?.disconnect()
  remoteAudio = null
  if (!stream.getAudioTracks().length) return
  remoteAudio = audio.createMediaStreamSource(stream)
  remoteAudio.connect(audioOutput())
}

function setVolume(volume) {
  const gain = audioOutput().gain
  gain.setTargetAtTime(volume, audio.currentTime, 0.015) // a short ramp, so muting doesn't click
  ui.volume.value = String(volume)
  ui.volumeControl.style.setProperty('--ratio', String(volume / Number(ui.volume.max)))
  ui.volumeReadout.value = `${Math.round(volume * 100)}%`
  const muted = volume === 0
  ui.mute.dataset.muted = String(muted)
  ui.mute.title = muted ? 'Unmute (M)' : 'Mute (M)'
  ui.mute.setAttribute('aria-pressed', String(muted))
  try {
    localStorage.setItem('volume', String(volume))
  } catch {}
}

function rememberVolume(volume) {
  if (!(volume > 0)) return
  unmutedVolume = volume
  try {
    localStorage.setItem('unmutedVolume', String(volume))
  } catch {}
}

function toggleMute() {
  const volume = Number(ui.volume.value)
  if (volume > 0) {
    rememberVolume(volume)
    setVolume(0)
  } else {
    setVolume(unmutedVolume)
  }
}

// The percentage shows above the knob while dragging, and briefly after keyboard or wheel changes.
let volumeDragging = false
let volumeReadoutTimer = null

function showVolumeReadout(lingerMs) {
  clearTimeout(volumeReadoutTimer)
  ui.volumeControl.classList.add('adjusting')
  if (lingerMs == null) return
  volumeReadoutTimer = setTimeout(() => ui.volumeControl.classList.remove('adjusting'), lingerMs)
}

function releaseVolume() {
  if (!volumeDragging) return
  volumeDragging = false
  showVolumeReadout(600)
}

ui.volume.addEventListener('pointerdown', () => {
  volumeDragging = true
  showVolumeReadout()
})
ui.volume.addEventListener('pointerup', releaseVolume)
ui.volume.addEventListener('pointercancel', releaseVolume)
ui.volume.addEventListener('input', () => {
  setVolume(Number(ui.volume.value))
  showVolumeReadout(volumeDragging ? null : 1000)
})
ui.volume.addEventListener('change', () => {
  rememberVolume(Number(ui.volume.value))
  releaseVolume()
})
ui.mute.addEventListener('click', toggleMute)
try {
  rememberVolume(Number(localStorage.getItem('unmutedVolume')))
  const saved = localStorage.getItem('volume')
  if (saved != null) setVolume(Number(saved))
  rememberVolume(Number(saved))
} catch {}

for (const type of ['play', 'pause', 'seeked', 'waiting', 'playing']) {
  ui.localVideo.addEventListener(type, () => broadcastState())
}
// Seeking back to the start works whether it's still buffered (a short clip) or ffmpeg has to restart.
// Without loop, a file started from the playlist moves on to the next item.
ui.localVideo.addEventListener('ended', () => {
  if (!isHost()) return
  if (!session.loop) return playNext()
  player.seek(0)
  ui.localVideo.play().catch(() => {})
})
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
  if (ui.room.hidden || !ui.settings.hidden || event.target.matches('input:not([type=range]), select, textarea')) return
  if (event.code === 'Space') {
    event.preventDefault()
    if (event.target instanceof HTMLButtonElement) event.target.blur()
    togglePlay()
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault()
    skip(event.code === 'ArrowLeft' ? -10 : 30)
  } else if (event.code === 'KeyL') {
    toggleLoop()
  } else if (event.code === 'KeyF') {
    toggleFullscreen()
  } else if (event.code === 'KeyP') {
    setPlaylistOpen(!playlistOpen())
  } else if (event.code === 'KeyM') {
    toggleMute()
  } else {
    const kind = Object.keys(REACTIONS).find((k) => REACTIONS[k].key === event.code || REACTIONS[k].key === `Digit${event.key}`)
    if (kind && !event.repeat) react(kind)
  }
})

for (const [kind, {emoji, label, key}] of Object.entries(REACTIONS)) {
  const button = element('button', 'reaction', emoji)
  button.dataset.reaction = kind
  button.title = `${label} (${key.replace('Digit', '')})`
  button.setAttribute('aria-label', label)
  button.addEventListener('click', () => {
    react(kind)
    setReactionsOpen(false)
  })
  ui.reactions.append(button)
}

// Reactions live in a menu that opens upward from one button in the controls.
function setReactionsOpen(open) {
  ui.reactions.hidden = !open
  ui.reactionsToggle.setAttribute('aria-expanded', String(open))
}
ui.reactionsToggle.addEventListener('click', () => setReactionsOpen(ui.reactions.hidden))
document.addEventListener('pointerdown', (event) => {
  if (!ui.reactions.hidden && !event.target.closest('.reaction-menu')) setReactionsOpen(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  setReactionsOpen(false)
  endItemDrag(false)
  if (!event.target.matches('input')) showSettings(false) // in the name box, Escape only undoes the edit
})

// While a video plays, the top bar, sidebar and controls get out of the way until the mouse moves.
let chromeTimer = null
const chromeInUse = () =>
  Boolean(
    drawing ||
      !ui.settings.hidden ||
      tabDrag ||
      itemDrag ||
      !ui.reactions.hidden ||
      ui.room.querySelector('.topbar:hover, .controls:hover, .sidebar:hover, .board-tools:hover, .playlist:hover, select:focus, input:focus'),
  )
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
// Nothing on the stage is draggable: a dragged picture would drop back in as a file with no path.
ui.stage.addEventListener('dragstart', (event) => event.preventDefault())
ui.stage.addEventListener('dragover', () => ui.stage.classList.add('dragging'))
ui.stage.addEventListener('dragleave', (event) => {
  if (!ui.stage.contains(event.relatedTarget)) ui.stage.classList.remove('dragging')
})
ui.stage.addEventListener('drop', (event) => {
  ui.stage.classList.remove('dragging')
  const file = event.dataTransfer.files[0]
  const filePath = file && window.api.pathForFile(file)
  if (!filePath) return // not a file on disk (dragged from a page, or from inside the app)
  if (!SUBTITLE_FILE.test(filePath)) return hostFile(filePath)
  addSubtitleFile(filePath)
})

window.addEventListener('beforeunload', () => {
  session.room?.leave()
  friendNetwork.stop()
})

setInterval(render, 250)
requestAnimationFrame(drawCaptions)
setInterval(sendStroke, 50)
setInterval(() => sampleConnection().catch(() => {}), TELEMETRY_INTERVAL_MS)
setInterval(() => {
  if (!isHost()) return
  broadcastState()
  tuneSenders()
}, STATE_INTERVAL_MS)
