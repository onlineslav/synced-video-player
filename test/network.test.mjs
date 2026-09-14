import test from 'node:test'
import assert from 'node:assert/strict'
import {createNetwork, deadline} from '../renderer/network.mjs'

class Peer extends EventTarget {
  constructor(config) { super(); this.config = config; this.restarts = 0; this.connectionState = 'connected' }
  getConfiguration() { return this.config }
  setConfiguration(config) { this.config = config }
  restartIce() { this.restarts++ }
  close() { this.connectionState = 'closed' }
}
const ice = (credential) => [{urls: 'turn:relay.example:3478', username: 'viewer', credential}]

test('relay renewal updates live connections and pooled constructors while preserving STUN', async () => {
  let now = 0, calls = 0, value = {iceServers: ice('first'), expiresAt: 100000}
  const network = createNetwork({getIceServers: async () => { calls++; return value }, PeerConnection: Peer, now: () => now})
  try {
    await network.ready
    const config = network.config()
    const live = new config.rtcPolyfill({iceServers: [{urls: 'stun:stun.example'}, ...ice('stale')]})
    assert.deepEqual(live.config.iceServers, [{urls: 'stun:stun.example'}, ...ice('first')])
    value = {iceServers: ice('second'), expiresAt: 200000}
    await Promise.all([network.refresh(), network.refresh()])
    assert.equal(calls, 2)
    assert.deepEqual(live.config.iceServers.at(-1), ice('second')[0])
    assert.equal(live.restarts, 1)
    const pooled = new config.rtcPolyfill({iceServers: config.turnConfig})
    assert.deepEqual(pooled.config.iceServers, ice('second'))
    value = {error: 'Temporary failure'}
    await network.refresh()
    assert.deepEqual(network.config().turnConfig, ice('second'))
    now = 200001
    await network.refresh()
    assert.deepEqual(network.config().turnConfig, [])
    assert.deepEqual(live.config.iceServers, [{urls: 'stun:stun.example'}])
    assert.deepEqual(pooled.config.iceServers, [])
    live.close(); pooled.close()
  } finally { network.stop() }
})

test('reconnect restarts interrupted peers and stop discards late relay responses', async () => {
  let resolve
  const network = createNetwork({getIceServers: () => [], PeerConnection: Peer})
  try {
    await network.ready
    const pc = new network.PeerConnection()
    pc.connectionState = 'disconnected'
    await network.reconnect()
    assert.equal(pc.restarts, 1)
    pc.close()
  } finally { network.stop() }
  const pending = createNetwork({getIceServers: () => new Promise((done) => { resolve = done }), PeerConnection: Peer})
  await Promise.resolve()
  pending.stop()
  resolve({iceServers: ice('late'), expiresAt: Date.now() + 100000})
  await pending.ready
  assert.deepEqual(pending.config().turnConfig, [])
  await assert.rejects(deadline(new Promise(() => {}), 5), /did not respond/)
})
