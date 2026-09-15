import test from 'node:test'
import assert from 'node:assert/strict'
import {RoomHistory} from '../renderer/room-history.mjs'
import {addItem, createPlaylist, mergePlaylist, moveItem, orderedItems, playlistSnapshot, recordProgress, removeItem} from '../renderer/playlist.mjs'

const storage = () => {
  const values = new Map()
  return {getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}
}
const checkpoint = (fields = {}) => ({id: 'a', position: 1, time: 45, duration: 120, completed: false, loop: false, claimedAt: 3, hostId: 'connection-old', sequence: 10, ...fields})
const room = () => {
  const playlist = createPlaylist()
  for (const [id, owner, position] of [['a', 'alice#1234-5678', 1], ['b', 'bob#1234-5678', 2], ['c', 'charlie#1234-5678', 3]]) {
    addItem(playlist, {id, title: `${id}.mp4`, position}, owner)
  }
  recordProgress(playlist, checkpoint())
  recordProgress(playlist, checkpoint({id: 'b', position: 2, time: 17, claimedAt: 4}))
  return {code: 'ABCDEFGH', details: {name: 'Movie night', revision: 2, updatedBy: 'peer'}, playlist,
    ownFiles: new Map([['a', 'C:/private/a.mp4']]), claimedAt: 4}
}

test('restarting restores room name, ordered playlist, per-item progress and only local file ownership', () => {
  const disk = storage(), original = room()
  moveItem(original.playlist, {id: 'c', position: 0, movedAt: 8, movedBy: 'other-peer'})
  new RoomHistory(disk, 'alice#1234-5678').save(original)
  const restarted = new RoomHistory(disk, 'alice#1234-5678')
  const restored = restarted.load('ABCDEFGH')
  assert.equal(restarted.list().length, 1)
  assert.equal(restored.details.name, 'Movie night')
  assert.deepEqual(orderedItems(restored.playlist).map(({id}) => id), ['c', 'a', 'b'])
  assert.equal(restored.playlist.progress.get('a').time, 45)
  assert.equal(restored.playlist.progress.get('b').time, 17)
  assert.equal(restored.playlist.current.id, 'b')
  assert.equal(restored.playlist.items.get('a').owner, 'alice#1234-5678')
  assert.equal(restored.ownFiles.get('a'), 'C:/private/a.mp4')
  assert.deepEqual(restarted.load('OTHER123'), null)
  assert.deepEqual(new RoomHistory(disk, 'bob#1234-5678').list(), [])
  assert.equal(JSON.stringify(playlistSnapshot(restored.playlist)).includes('private'), false)
})

test('offline snapshots merge progress and removals without rewinding or resurrecting removed media', () => {
  const a = room(), b = room()
  const stale = structuredClone(playlistSnapshot(a.playlist))
  recordProgress(a.playlist, checkpoint({time: 70, claimedAt: 5, hostId: 'new-connection', sequence: 1}))
  removeItem(a.playlist, 'c')
  mergePlaylist(b.playlist, playlistSnapshot(a.playlist))
  mergePlaylist(b.playlist, stale)
  assert.equal(b.playlist.progress.get('a').time, 70)
  assert.equal(b.playlist.current.id, 'a')
  assert.equal(b.playlist.items.has('c'), false)
  recordProgress(b.playlist, checkpoint({time: 12, claimedAt: 5, hostId: 'new-connection', sequence: 2}))
  assert.equal(b.playlist.progress.get('a').time, 12, 'a newer backwards seek wins')
  assert.equal(b.playlist.progress.get('b').time, 17, 'other items retain their progress')
  mergePlaylist(a.playlist, playlistSnapshot(b.playlist))
  assert.deepEqual(playlistSnapshot(a.playlist), playlistSnapshot(b.playlist))
})

test('corrupt storage and untrusted snapshots cannot supply local file paths', () => {
  const disk = storage(), history = new RoomHistory(disk, 'alice#1234-5678')
  disk.setItem(`${history.prefix}index`, 'not json')
  assert.deepEqual(history.list(), [])
  const saved = room()
  saved.ownFiles.set('b', 'C:/not-selected/b.mp4')
  history.save(saved)
  assert.equal(history.load(saved.code).ownFiles.has('b'), false)
  const fresh = createPlaylist()
  mergePlaylist(fresh, playlistSnapshot(saved.playlist), {selfId: 'alice#1234-5678', ownFiles: new Map()})
  assert.equal(fresh.items.has('a'), false, 'remote snapshot cannot authorize a local file')
  const otherRoom = {...room(), code: 'OTHER123', ownFiles: new Map(), playlist: createPlaylist()}
  history.save(otherRoom)
  assert.equal(history.load('OTHER123').ownFiles.size, 0)
})

test('progress rejects malformed values and preserves completion and removed cursor position', () => {
  const playlist = room().playlist
  for (const fields of [{time: NaN}, {duration: -1}, {position: Infinity}, {sequence: -1}, {hostId: null}, {completed: 'yes'}]) {
    assert.equal(recordProgress(playlist, checkpoint(fields)), false)
  }
  recordProgress(playlist, checkpoint({time: 120, completed: true, claimedAt: 5}))
  removeItem(playlist, 'a')
  const restored = createPlaylist()
  mergePlaylist(restored, playlistSnapshot(playlist))
  assert.equal(restored.current.id, 'a')
  assert.equal(restored.current.position, 1)
  assert.equal(restored.progress.has('a'), false)
})

test('storage failures are reported to the caller instead of silently claiming the room was saved', () => {
  const disk = {getItem: () => null, setItem: () => { throw new Error('disk full') }}
  assert.throws(() => new RoomHistory(disk, 'alice#1234-5678').save(room()), /disk full/)
})
