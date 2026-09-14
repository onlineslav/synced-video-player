import test from 'node:test'
import assert from 'node:assert/strict'
import {FriendNetwork, helloText, pairRoomId, presenceText} from '../renderer/friends.mjs'
import {createIdentity, sign, verifySigned} from '../renderer/identity.mjs'

// Trystero in memory: everyone in a room id is connected to everyone else in it.
function fakeTrystero() {
  const rooms = new Map()
  const joined = []
  const joinRoomAs = (selfId) => (_config, roomId) => {
    const members = rooms.get(roomId) || new Map()
    rooms.set(roomId, members)
    joined.push([selfId, roomId])
    const room = {
      actions: new Map(),
      onPeerJoin: null,
      onPeerLeave: null,
      makeAction(name) {
        const action = {
          onMessage: null,
          send: async (data, {target} = {}) => {
            for (const [id, other] of members) {
              if (id === selfId || (target && target !== id)) continue
              setTimeout(() => other.actions.get(name)?.onMessage?.(structuredClone(data), {peerId: selfId}))
            }
          },
        }
        room.actions.set(name, action)
        return action
      },
      async leave() {
        members.delete(selfId)
        for (const other of members.values()) setTimeout(() => other.onPeerLeave?.(selfId))
      },
    }
    for (const [id, other] of members) {
      setTimeout(() => {
        other.onPeerJoin?.(selfId)
        room.onPeerJoin?.(id)
      })
    }
    members.set(selfId, room)
    return room
  }
  return {joinRoomAs, rooms, joined}
}

const memoryStorage = () => {
  const data = new Map()
  return {load: (key) => structuredClone(data.get(key) ?? null), save: (key, value) => data.set(key, structuredClone(value))}
}

async function person(net, selfId, name) {
  const identity = await createIdentity('tester')
  const storage = memoryStorage()
  const friends = new FriendNetwork({joinRoom: net.joinRoomAs(selfId), selfId, appId: 'test', storage})
  friends.start(identity, {name})
  return {identity, friends, storage, selfId}
}

async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${typeof what === 'function' ? what() : what}`)
}

test('signed hellos prove a username and only for the room and peers they name', async () => {
  const me = await createIdentity('tester')
  const other = await createIdentity('tester')
  const text = helloText('pair:x', 'peerA', 'peerB')
  const hello = {username: me.username, publicKey: me.publicKey, signature: await sign(me, text)}
  assert.ok(await verifySigned(hello, text))
  assert.ok(!(await verifySigned(hello, helloText('pair:x', 'peerA', 'peerC'))), 'other peer')
  assert.ok(!(await verifySigned({...hello, username: other.username}, text)), 'someone else’s username')
  assert.ok(!(await verifySigned({...hello, publicKey: other.publicKey}, text)), 'someone else’s key')
  assert.ok(!(await verifySigned(undefined, text)))
})

test('adding someone sends a request they can accept, and then you are friends', async () => {
  const net = fakeTrystero()
  const alice = await person(net, 'a', 'Alice')
  const bob = await person(net, 'b', 'Bob')

  assert.equal(alice.friends.add(bob.identity.username.toUpperCase()), null)
  await until(() => bob.friends.requestList().length === 1, 'request')
  assert.deepEqual(bob.friends.requestList(), [{username: alice.identity.username, name: 'Alice'}])
  await until(() => alice.friends.list()[0].requested, 'request delivered')
  assert.ok(!net.rooms.get(`inbox:${bob.identity.username}`).has('a'), 'alice stops waiting in bob’s inbox')

  assert.equal(bob.friends.add(alice.identity.username), null)
  await until(
    () => alice.friends.list()[0]?.online && bob.friends.list()[0]?.online,
    () => `friends connected: ${JSON.stringify({alice: alice.friends.list(), bob: bob.friends.list(), pair: [...(net.rooms.get(pairRoomId(alice.identity.username, bob.identity.username))?.keys() || [])], links: {a: [...alice.friends.links.keys()], b: [...bob.friends.links.keys()]}})}`,
  )
  assert.equal(alice.friends.list()[0].name, 'Bob')
  assert.equal(bob.friends.list()[0].name, 'Alice')
  assert.ok(alice.friends.list()[0].confirmed && bob.friends.list()[0].confirmed)
  assert.equal(bob.friends.requestList().length, 0)
  assert.deepEqual([...net.rooms.get(pairRoomId(alice.identity.username, bob.identity.username)).keys()].sort(), ['a', 'b'])

  // Names follow changes, and friends survive a restart from storage.
  alice.friends.updateProfile({name: 'Alice B'})
  await until(() => bob.friends.list()[0].name === 'Alice B', 'renamed')
  const restored = new FriendNetwork({joinRoom: () => ({}), selfId: 'b2', appId: 'test', storage: bob.storage})
  assert.equal(restored.list()[0].username, alice.identity.username)

  bob.friends.remove(alice.identity.username)
  await until(() => !alice.friends.list()[0].online, 'offline after removal')
  assert.equal(bob.friends.list().length, 0)
})

test('a peer claiming someone else’s username is ignored', async () => {
  const net = fakeTrystero()
  const alice = await person(net, 'a', 'Alice')
  const bob = await createIdentity('tester')
  alice.friends.add(bob.username)

  // Mallory knows both usernames and joins the pair room pretending to be Bob.
  const mallory = await createIdentity('tester')
  const room = net.joinRoomAs('m')({}, pairRoomId(alice.identity.username, bob.username))
  const hello = room.makeAction('hello')
  const profile = room.makeAction('profile')
  room.onPeerJoin = async (peerId) => {
    const signature = await sign(mallory, helloText(pairRoomId(alice.identity.username, bob.username), 'm', peerId))
    hello.send({username: bob.username, publicKey: mallory.publicKey, signature}, {target: peerId})
    profile.send({name: 'Totally Bob'}, {target: peerId})
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual(alice.friends.list(), [{username: bob.username, name: null, confirmed: false, requested: false, online: false, status: null}])
})

test('friends see each other online, in a room and hosting, and then offline', async () => {
  const net = fakeTrystero()
  const alice = await person(net, 'a', 'Alice')
  const bob = await person(net, 'b', 'Bob')
  alice.friends.add(bob.identity.username)
  bob.friends.add(alice.identity.username)
  await until(() => alice.friends.list()[0]?.online && bob.friends.list()[0]?.online, 'online')
  assert.equal(presenceText(bob.friends.list()[0]), 'Online')

  alice.friends.updateProfile({name: 'Alice', status: {inRoom: true}})
  await until(() => bob.friends.list()[0].status?.inRoom, 'in a room')
  assert.equal(presenceText(bob.friends.list()[0]), 'In a room')

  const title = `Heat${String.fromCharCode(0)}   (1995)`
  alice.friends.updateProfile({name: 'Alice', status: {inRoom: true, hosting: true, title}})
  await until(() => bob.friends.list()[0].status?.hosting, 'hosting')
  assert.equal(presenceText(bob.friends.list()[0]), 'Hosting Heat (1995)')

  alice.friends.stop()
  await until(() => !bob.friends.list()[0].online, 'offline')
  assert.equal(bob.friends.list()[0].status, null)
  assert.equal(presenceText(bob.friends.list()[0]), 'Offline')
})

test('presenceText explains friends who have not added you back yet', () => {
  assert.equal(presenceText({confirmed: false, requested: true}), 'Waiting for them to add you back')
  assert.equal(presenceText({confirmed: false, requested: false}), 'Request sends when they next open the app')
  assert.equal(presenceText({confirmed: true, online: true, status: {hosting: true, title: null}}), 'Hosting a room')
})

test('add rejects bad input', async () => {
  const net = fakeTrystero()
  const alice = await person(net, 'a', 'Alice')
  assert.match(alice.friends.add('hello'), /isn't a username/)
  assert.match(alice.friends.add(alice.identity.username), /your own/)
  const other = (await createIdentity('tester')).username
  assert.equal(alice.friends.add(other), null)
  assert.match(alice.friends.add(other), /Already/)
  alice.friends.stop()
})
