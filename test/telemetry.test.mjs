import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BUFFER_MS,
  MIN_BUFFER_MS,
  adaptBuffer,
  describeLink,
  inboundDelta,
  isSteady,
  isTroubled,
  nextSteady,
  readStats,
} from '../renderer/telemetry.mjs'

test('nextSteady only counts uninterrupted playback', () => {
  let steady = {since: null, epoch: 0}
  steady = nextSteady(steady, {playing: true, time: 10, epoch: 0}, 10, 1000)
  steady = nextSteady(steady, {playing: true, time: 12, epoch: 0}, 12.1, 3000)
  assert.equal(steady.since, 1000)
  assert.ok(isSteady(steady, 5000))
  assert.ok(!isSteady(steady, 4000))
  assert.equal(nextSteady(steady, {playing: true, time: 60, epoch: 0}, 14, 5000).since, 5000, 'seek jump')
  assert.equal(nextSteady(steady, {playing: true, time: 14, epoch: 1}, 14, 5000).since, 5000, 'ffmpeg restarted')
  assert.equal(nextSteady(steady, {playing: false, time: 14, epoch: 0}, 14, 5000).since, null, 'paused')
})

const report = [
  {id: 'p', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.042, localCandidateId: 'l', remoteCandidateId: 'r'},
  {id: 'l', type: 'local-candidate', candidateType: 'srflx'},
  {id: 'r', type: 'remote-candidate', candidateType: 'relay'},
  {id: 'old', type: 'inbound-rtp', kind: 'video', ssrc: 1, packetsReceived: 900, frameHeight: 720},
  {id: 'in', type: 'inbound-rtp', kind: 'video', ssrc: 2, packetsReceived: 100, packetsLost: 3, framesPerSecond: 24, frameHeight: 1080, jitter: 0.012},
  {id: 'out', type: 'outbound-rtp', kind: 'video', framesPerSecond: 24, frameHeight: 1080, qualityLimitationReason: 'cpu'},
]

test('readStats picks the live streams and the active connection', () => {
  const stats = readStats(report)
  assert.equal(stats.rttMs, 42)
  assert.equal(stats.relayed, true)
  assert.equal(stats.inbound.ssrc, 2)
  assert.equal(stats.inbound.jitterMs, 12)
  assert.deepEqual(stats.outbound, {fps: 24, height: 1080, limit: 'cpu'})
})

test('inboundDelta measures loss and ignores replaced streams', () => {
  const a = {ssrc: 2, packetsReceived: 100, packetsLost: 0, freezeCount: 0, framesDropped: 0}
  const b = {ssrc: 2, packetsReceived: 190, packetsLost: 10, freezeCount: 1, framesDropped: 2}
  assert.deepEqual(inboundDelta(a, b), {lossPct: 10, freezes: 1, droppedFrames: 2})
  assert.equal(inboundDelta(a, {...b, ssrc: 3}), null)
  assert.ok(isTroubled(inboundDelta(a, b), 5))
  assert.ok(!isTroubled({lossPct: 1, freezes: 0}, 10))
})

test('adaptBuffer grows fast, caps, and shrinks only after a calm stretch', () => {
  let state = {bufferMs: MIN_BUFFER_MS, calmMs: 0}
  for (let i = 0; i < 5; i++) state = adaptBuffer(state, true, 2000)
  assert.equal(state.bufferMs, MAX_BUFFER_MS)
  for (let i = 0; i < 14; i++) state = adaptBuffer(state, false, 2000)
  assert.equal(state.bufferMs, MAX_BUFFER_MS)
  state = adaptBuffer(state, false, 2000)
  assert.equal(state.bufferMs, MAX_BUFFER_MS - 250)
})

test('describeLink explains what is limiting playback from each side', () => {
  const good = describeLink({selfRole: 'viewer', rttMs: 42, sender: {height: 1080, fps: 24, limit: 'none'}, receiver: {height: 1080, fps: 23.9, lossPct: 0, freezes: 0, bufferMs: 250}})
  assert.deepEqual(good, {level: 'good', text: '42 ms · 1080p24', detail: 'Connection looks good.'})

  const busyHost = describeLink({selfRole: 'host', rttMs: 60, sender: {height: 720, fps: 24, limit: 'cpu'}})
  assert.equal(busyHost.level, 'fair')
  assert.match(busyHost.detail, /^Your computer is too busy/)

  const dropping = describeLink({selfRole: 'host', rttMs: 90, receiver: {height: 720, fps: 20, lossPct: 8, freezes: 2, bufferMs: 1000}})
  assert.equal(dropping.level, 'poor')
  assert.match(dropping.detail, /Your friend's connection is dropping video \(8% packet loss\)/)
  assert.match(dropping.detail, /buffering 1\.00 s/)
})
