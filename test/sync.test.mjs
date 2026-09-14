import test from 'node:test'
import assert from 'node:assert/strict'
import {updateClock, estimatedMediaTime, chooseSendQuality, aggregateLinks} from '../renderer/sync.mjs'
import {adaptBuffer, MAX_BUFFER_MS} from '../renderer/telemetry.mjs'

test('media clock accounts for transit and stops extrapolating a stalled host', () => {
  const clock = updateClock(null, 100, 200, 1150)
  assert.equal(clock.offset, 1000)
  const state = {time: 10, sentAt: 1200, receivedAt: 300, duration: 100, playing: true}
  assert.equal(estimatedMediaTime(state, 1300, clock), 11.1)
  assert.equal(estimatedMediaTime({...state, playing: false}, 1300, clock), 10)
  assert.ok(estimatedMediaTime(state, 100000, clock) <= 18.1)
  assert.equal(updateClock(clock, 100, 90, 100), clock)
})

test('persistent packet loss lowers quality while buffering stays bounded', () => {
  let quality = null, buffer = {bufferMs: 250, calmMs: 0}
  for (let i = 0; i < 12; i++) {
    quality = chooseSendQuality(quality, {receiver: {lossPct: 5}, width: 1920, height: 1080})
    buffer = adaptBuffer(buffer, true, 2000)
  }
  assert.ok(quality.bitrate < 1e6)
  assert.ok(quality.scale >= 3)
  assert.equal(buffer.bufferMs, MAX_BUFFER_MS)
  const reduced = quality.bitrate
  for (let i = 0; i < 24; i++) quality = chooseSendQuality(quality, {receiver: {lossPct: 0}})
  assert.ok(quality.bitrate > reduced)
})

test('quality respects dimensions, available bandwidth and group upload budget', () => {
  const quality = chooseSendQuality({bitrate: 10e6}, {peerCount: 7, width: 3840, height: 2160, capacity: 1e6})
  assert.ok(quality.bitrate <= 800000)
  assert.ok(quality.scale >= 6)
  const peers = Array.from({length: 7}, () => chooseSendQuality({bitrate: 10e6}, {peerCount: 7}))
  assert.ok(peers.reduce((n, p) => n + p.bitrate, 0) <= 18e6 + 7)
})

test('group health uses one complete peer record', () => {
  const good = {rttMs: 10, sender: {limit: 'none'}, receiver: {lossPct: 0}}
  const bad = {rttMs: 150, sender: {limit: 'bandwidth'}, receiver: {lossPct: 10}}
  assert.equal(aggregateLinks([good, bad]), bad)
})
