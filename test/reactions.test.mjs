import test from 'node:test'
import assert from 'node:assert/strict'
import {launchConfetti, stepConfetti} from '../renderer/confetti.mjs'
import {REACTIONS, createRateLimiter, playReactionSound} from '../renderer/reactions.mjs'

// Just enough of Web Audio to record what a sound schedules.
function fakeAudio() {
  const log = {sources: [], peaks: [], connections: 0}
  const param = () => ({
    value: 0,
    setValueAtTime(value) {
      log.peaks.push(value)
    },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime(value) {
      assert.ok(value > 0, 'exponential ramps must not reach 0')
      log.peaks.push(value)
    },
  })
  const node = (extra = {}) => ({
    connect(target) {
      log.connections++
      return target
    },
    ...extra,
  })
  const source = () => {
    const entry = {started: null, stopped: null}
    log.sources.push(entry)
    return node({
      frequency: param(),
      detune: param(),
      start: (t) => (entry.started = t),
      stop: (t) => (entry.stopped = t),
    })
  }
  const ctx = {
    currentTime: 5,
    sampleRate: 48000,
    createOscillator: source,
    createBufferSource: source,
    createGain: () => node({gain: param()}),
    createBiquadFilter: () => node({frequency: param(), Q: param(), gain: param()}),
    createBuffer: (_channels, length) => ({getChannelData: () => new Float32Array(length)}),
  }
  return {ctx, log}
}

test('every reaction plays a sound that starts now, stops, and stays at a sane volume', () => {
  for (const kind of Object.keys(REACTIONS)) {
    const {ctx, log} = fakeAudio()
    playReactionSound(ctx, {}, kind)
    assert.ok(log.sources.length > 0, `${kind} makes sound`)
    for (const {started, stopped} of log.sources) {
      assert.ok(started >= ctx.currentTime && stopped > started && stopped < ctx.currentTime + 3, `${kind} is short`)
    }
    assert.ok(Math.max(...log.peaks.filter((v) => v < 10)) <= 0.6, `${kind} isn't too loud`)
  }
  const {ctx, log} = fakeAudio()
  playReactionSound(ctx, {}, 'nonsense')
  assert.equal(log.sources.length, 0)
})

test('the rate limiter allows one reaction per person per cooldown', () => {
  const allow = createRateLimiter(800)
  assert.ok(allow('a', 1000))
  assert.ok(!allow('a', 1500))
  assert.ok(allow('b', 1500), 'other people are separate')
  assert.ok(allow('a', 1800))
})

test('confetti rains in from above and is gone a few seconds later', () => {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let particles = launchConfetti(800, 600, 50, random)
  assert.equal(particles.length, 50)
  assert.ok(particles.every((p) => p.y < 0 && p.x >= 0 && p.x <= 800))
  let seconds = 0
  while (particles.length && seconds < 10) {
    particles = stepConfetti(particles, 1 / 60, 600)
    seconds += 1 / 60
  }
  assert.equal(particles.length, 0)
  assert.ok(seconds > 1 && seconds < 5, `took ${seconds.toFixed(1)}s`)
})
