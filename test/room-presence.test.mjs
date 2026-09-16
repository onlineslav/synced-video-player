import test from 'node:test'
import assert from 'node:assert/strict'
import {RoomPresence, PRESENCE_TIMEOUT_MS} from '../renderer/room-presence.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function harness(t) {
  let now = 0
  const opened = []
  const presence = new RoomPresence({selfId: 'self', appId: 'test', now: () => now,
    authenticate: async (_identity, _self, code, peer) => { assert.match(code, /:presence$/); return `${peer}#1234-5678` },
    joinRoom: (config, code, callbacks) => {
      const sent = []
      const action = {send: async (message, options) => { sent.push({message, options}) }}
      const room = {makeAction: () => action, leave: async () => { room.left = true }}
      opened.push({config, code, callbacks, room, action, sent})
      return room
    },
  })
  t.after(() => presence.stop())
  presence.start({username: 'me'})
  return {presence, opened, advance: (ms) => { now += ms },
    join: async (link, peer) => {
      await link.callbacks.onPeerHandshake(peer)
      link.room.onPeerJoin(peer)
    },
    message: (link, peer, fields = {}) => link.action.onMessage({inRoom: true, name: peer, sequence: 1, ...fields}, {peerId: peer}),
  }
}

test('home observers are not occupants; only authenticated active members appear', async (t) => {
  const h = harness(t)
  h.presence.update(['ABCDEFGH'], null, 'Me')
  await tick()
  const link = h.opened[0]
  assert.equal(link.config.appId, 'test')
  assert.equal(link.code, 'presence:ABCDEFGH')
  assert.equal(link.sent[0].message.inRoom, false)
  h.message(link, 'unverified')
  assert.deepEqual(h.presence.list('ABCDEFGH').members, [])
  await h.join(link, 'alice')
  await h.join(link, 'observer')
  h.message(link, 'alice', {name: ' Alice '})
  h.message(link, 'observer', {inRoom: false})
  assert.deepEqual(h.presence.list('ABCDEFGH').members.map(({name}) => name), ['Alice'])
  h.presence.update(['ABCDEFGH'], 'ABCDEFGH', 'Me')
  assert.equal(link.sent.at(-1).message.inRoom, true)
  h.presence.update(['ABCDEFGH'], null, 'Me')
  assert.equal(link.sent.at(-1).message.inRoom, false)
})

test('departure, expiry and updated names replace live presence without stale replay', async (t) => {
  const h = harness(t)
  h.presence.update(['ABCDEFGH'], null, 'Me')
  await tick()
  const link = h.opened[0]
  await h.join(link, 'alice')
  h.message(link, 'alice')
  h.message(link, 'alice', {sequence: 2, name: 'New name'})
  h.message(link, 'alice', {sequence: 1, name: 'Old name'})
  assert.equal(h.presence.list('ABCDEFGH').members[0].name, 'New name')
  h.advance(PRESENCE_TIMEOUT_MS + 1)
  assert.equal(h.presence.list('ABCDEFGH').members.length, 0)
  h.message(link, 'alice', {sequence: 3})
  link.room.onPeerLeave('alice')
  h.message(link, 'alice', {sequence: 4})
  assert.equal(h.presence.list('ABCDEFGH').members.length, 0)
})

test('switching rooms isolates occupants and ignores callbacks from disposed channels', async (t) => {
  const h = harness(t)
  h.presence.update(['ABCDEFGH'], null, 'Me')
  await tick()
  const old = h.opened[0]
  await h.join(old, 'alice')
  h.presence.update(['OTHER123'], 'OTHER123', 'Me')
  await tick()
  h.message(old, 'alice')
  assert.equal(old.room.left, true)
  assert.equal(h.presence.list('ABCDEFGH').members.length, 0)
  assert.equal(h.presence.list('OTHER123').members.length, 0)
  assert.equal(h.opened[1].sent.at(-1).message.inRoom, true)
})

test('rapid return waits for the prior channel to finish leaving', async (t) => {
  const h = harness(t)
  h.presence.update(['ABCDEFGH'], null, 'Me')
  await tick()
  let finish
  h.opened[0].room.leave = () => new Promise((resolve) => { finish = resolve })
  h.presence.update([], null, 'Me')
  await tick()
  h.presence.update(['ABCDEFGH'], null, 'Me')
  h.presence.update([], null, 'Me')
  h.presence.update(['ABCDEFGH'], null, 'Me')
  await tick()
  assert.equal(h.opened.length, 1)
  finish()
  await tick()
  assert.equal(h.opened.length, 2)
})
