import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createPlaylist, addItem, removeItem, mergePlaylist} from '../renderer/playlist.mjs'

// Exercise the renderer's message handlers with media/network boundaries stubbed.
const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8')

test('new media loads paused at zero in an empty player; queued additions preserve current playback', () => {
  const calls = []
  const session = {role: 'idle', ownFiles: new Map([['local', 'movie.mp4']])}
  const context = vm.createContext({session,
    hostFile: (...args) => calls.push(['file', ...args]), hostYouTube: (...args) => calls.push(['youtube', ...args]),
  })
  vm.runInContext(source.match(/^function loadAddedMedia\([^]*?^}/m)[0], context)
  context.loadAddedMedia([{id: 'local'}])
  assert.equal(calls[0][1], 'movie.mp4')
  assert.deepEqual({...calls[0][3]}, {start: 0, autoplay: false})
  context.loadAddedMedia([{id: 'yt', youtubeId: 'M7lc1UVf-VE'}])
  assert.deepEqual({...calls[1][2]}, {start: 0, autoplay: false})
  session.role = 'host'
  context.loadAddedMedia([{id: 'local'}])
  session.role = 'viewer'
  context.loadAddedMedia([{id: 'yt', youtubeId: 'M7lc1UVf-VE'}])
  assert.equal(calls.length, 2)
  context.loadAddedMedia([{id: 'local'}], {replace: true})
  assert.equal(calls.length, 3)
  assert.deepEqual({...calls[2][3]}, {start: 0, autoplay: false})
})
function setup(role = 'host') {
  const playlist = createPlaylist()
  for (const id of ['playing', 'other']) addItem(playlist, {id, title: id, position: 1}, 'owner')
  const session = {role, playlist, playing: {id: 'playing'}, remote: role === 'viewer' ? {playlistId: 'playing'} : null,
    ownFiles: new Map(), availableFiles: new Set(), identities: new Map([['peer', 'owner']]), peers: new Set(['peer']),
    claimedAt: 1, imageTransfers: new Map(), captions: {}, openingMedia: true}
  const calls = {closed: 0, detached: 0, unpublished: 0, sent: []}
  session.playlistAction = {send: (message) => { calls.sent.push(message); return Promise.resolve() }}
  const context = vm.createContext({session, removeItem, mergePlaylist, identity: {username: 'self'},
    youtube: {close: () => {}},
    isHost: () => session.role === 'host', player: {close: () => calls.closed++},
    detachRemoteStream: () => calls.detached++, unpublishStream: () => calls.unpublished++, clearHostImage: () => {},
    setRole: (role) => { session.role = role }, render: () => {}, saveRoom: () => {}, shareAvailability: () => {},
    broadcastState: () => {}, checkpointPlayback: () => {}, toast: () => {}, cleanState: (state) => state,
    acceptsState: () => true, sameClaim: () => true, nextSteady: () => ({}), viewerTime: () => 0,
    performance, ui: {stage: {dataset: {}}}, attachRemoteStream: () => assert.fail('Removed media must not attach'),
  })
  for (const name of ['stopHosting', 'stopRemovedPlayback', 'removeFromPlaylist', 'receivePlaylist', 'receiveState']) {
    const body = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))?.[0]
    assert.ok(body, `Found ${name}`)
    vm.runInContext(body, context)
  }
  return {session, calls, context}
}

for (const role of ['host', 'viewer']) test(`Removing current media stops ${role} playback, including an opening file`, () => {
  const {session, calls, context} = setup(role)
  context.removeFromPlaylist('playing')
  assert.equal(session.role, 'idle')
  assert.equal(session.playing, null)
  assert.equal(session.remote, null)
  assert.equal(session.openingMedia, false)
  assert.equal(calls.closed, 1)
  assert.equal(calls.detached, 1)
  assert.equal(calls.unpublished, 1)
  assert.equal(calls.sent[0].type, 'remove')
})

test('Removing another item leaves current playback running', () => {
  const {session, calls, context} = setup()
  context.removeFromPlaylist('other')
  assert.equal(session.role, 'host')
  assert.equal(calls.closed, 0)
})

for (const message of [{type: 'remove', id: 'playing'}, {type: 'sync', removed: ['playing']}]) {
  test(`Remote ${message.type} stops removed playback`, () => {
    const {session, calls, context} = setup()
    context.receivePlaylist(message, 'peer')
    assert.equal(session.role, 'idle')
    assert.equal(calls.closed, 1)
  })
}

test('A delayed state cannot restart removed media', () => {
  const {session, context} = setup('viewer')
  context.removeFromPlaylist('playing')
  context.receiveState({playlistId: 'playing', hostId: 'peer', claimedAt: 2, sequence: 2, viewers: {}}, 'peer')
  assert.equal(session.role, 'idle')
  assert.equal(session.remote, null)
  assert.equal(session.authority.sequence, 2)
})
