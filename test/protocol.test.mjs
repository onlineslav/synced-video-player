import test from 'node:test'
import assert from 'node:assert/strict'
import {PROTOCOL, cleanState, cleanTelemetry, cleanCues, SubtitleCatalog, acceptsState, nextRevision, sessionHandler, validCommand} from '../renderer/protocol.mjs'
import {createPlaylist, addItem, removeItem, mergePlaylist, MAX_REMOVED} from '../renderer/playlist.mjs'
import {createBoard, addStrokeChunk, clearBoard, mergeSnapshot, boardSnapshot, orderedStrokes, MAX_STROKES} from '../renderer/whiteboard.mjs'

const state = (fields = {}) => ({protocol: PROTOCOL, hostId: 'host', claimedAt: 1, sequence: 1, epoch: 0, sentAt: 500,
  time: 10, duration: 100, loading: false, playing: true, buffering: false, loop: false, audioOnly: false,
  transcoding: false, ended: false, image: null, playlistId: null, title: 'Test', audio: [], subtitles: [],
  audioSelected: '', subtitleSelected: '', viewers: {}, senders: {}, ...fields})

test('state validation rejects malformed fields and spoofed transport identity before mutation', () => {
  assert.ok(cleanState(state(), 'host'))
  for (const fields of [{subtitles: {}}, {audio: [null]}, {time: '10'}, {duration: Infinity}, {hostId: 'other'}, {viewers: {x: {lossPct: '2'}}}, {epoch: -1}, {playing: 'yes'}, {subtitles: [{value: 'local:C:/secret.srt', label: 'x'}]}, {image: {id: 'old'}}, {audioSelected: '42'}]) {
    assert.equal(cleanState(state(fields), 'host'), null, JSON.stringify(fields))
  }
})

test('opaque subtitle catalogs never publish paths and only resolve selected local files', () => {
  const catalog = new SubtitleCatalog()
  const published = catalog.publish([{id: 'external:C:/private/movie.srt', label: 'Movie', image: false}])
  assert.equal(published[0].value, 'track:0')
  assert.ok(!JSON.stringify(published).includes('private'))
  assert.equal(catalog.resolve('track:0'), 'external:C:/private/movie.srt')
  assert.equal(catalog.resolve('local:http://example.test'), null)
  const local = catalog.addLocal('C:/selected.srt')
  assert.equal(catalog.local.get(local), 'C:/selected.srt')
  assert.equal(new SubtitleCatalog().local.get(local), undefined)
})

test('YouTube state accepts identifiers only and cannot also claim an image', () => {
  assert.equal(cleanState(state({youtubeId: 'M7lc1UVf-VE'}), 'host').youtubeId, 'M7lc1UVf-VE')
  for (const youtubeId of ['', 'https://youtube.com/watch?v=M7lc1UVf-VE', '../file', {}]) {
    assert.equal(cleanState(state({youtubeId}), 'host'), null)
  }
  assert.equal(cleanState(state({youtubeId: 'M7lc1UVf-VE', image: {id: '1'}}), 'host'), null)
})

test('all roles reject losing host claims and out-of-order messages within a claim', () => {
  const current = {hostId: 'b', claimedAt: 10, sequence: 5}
  assert.equal(acceptsState({hostId: 'a', claimedAt: 9, sequence: 999}, current), false)
  assert.equal(acceptsState({...current, sequence: 4}, current), false)
  assert.equal(acceptsState({...current, sequence: 6}, current), true)
  assert.equal(acceptsState({hostId: 'a', claimedAt: nextRevision(current.claimedAt), sequence: 1}, current), true)
})

test('session handlers reject old callbacks even when the same peer is in the next room', () => {
  const old = {peers: new Set(['peer'])}
  let current = old, calls = 0
  const message = sessionHandler(old, () => current, () => calls++)
  const request = sessionHandler(old, () => current, () => calls++, {request: true})
  message({}, {peerId: 'peer'})
  current = {peers: new Set(['peer'])}
  message({}, {peerId: 'peer'})
  assert.throws(() => request({}, {peerId: 'peer'}), /no longer active/)
  assert.equal(calls, 1)
})

test('commands and subtitle responses reject unsafe values', () => {
  const media = {duration: 100, audio: [{index: 2}], subtitles: [{id: 'image', image: true}]}
  assert.equal(validCommand('seek', '50', media), false)
  assert.equal(validCommand('seek', NaN, media), false)
  assert.equal(validCommand('seek', 101, media), false)
  assert.equal(validCommand('audio', '3', media), false)
  assert.ok(validCommand('seek', 50, media))
  assert.ok(validCommand('audio', '2', media))
  assert.equal(cleanTelemetry({lossPct: '2'}), null)
  assert.throws(() => cleanCues([{start: 0, end: 1, text: {}}]))
  assert.throws(() => cleanCues('not cues'))
})

test('a remote snapshot cannot recreate local file ownership in a later room', () => {
  const oldFile = {id: 'old', owner: 'me', title: 'Private.mp4', position: 1}
  const list = createPlaylist()
  mergePlaylist(list, {items: [oldFile]}, {selfId: 'me', ownFiles: new Map([['old', 'C:/private.mp4']])})
  assert.equal(list.items.size, 0)
  addItem(list, {...oldFile, id: 'selected'}, 'me')
  mergePlaylist(list, {items: [{...oldFile, id: 'selected', movedAt: 1, movedBy: 'peer', position: 2}]}, {selfId: 'me', ownFiles: new Map([['selected', 'C:/selected.mp4']])})
  assert.equal(list.items.get('selected').position, 2)
})

test('playlist history is bounded without resurrecting old removals', () => {
  const list = createPlaylist()
  addItem(list, {id: 'kept', title: 'Test', position: 1}, 'peer')
  for (let i = 0; i < MAX_REMOVED * 2; i++) removeItem(list, `removed:${i}`)
  removeItem(list, 'kept')
  assert.equal(list.removed.size, MAX_REMOVED)
  assert.equal(list.items.size, 0)
  mergePlaylist(list, {items: [{id: 'kept', owner: 'peer', title: 'Test', position: 1}]})
  assert.equal(list.items.size, 0)
})

test('board ordering converges for concurrent pen/eraser and new strokes follow logical clears', () => {
  const pen = {id: 'pen', at: 1, color: '#ffffff', size: 1, points: [0, 0]}
  const eraser = {...pen, id: 'eraser', color: 'erase'}
  const a = createBoard(), b = createBoard()
  addStrokeChunk(a, pen); addStrokeChunk(a, eraser)
  addStrokeChunk(b, eraser); addStrokeChunk(b, pen)
  mergeSnapshot(a, boardSnapshot(b)); mergeSnapshot(b, boardSnapshot(a))
  assert.deepEqual(orderedStrokes(a), orderedStrokes(b))
  clearBoard(a, nextRevision(a.revision))
  mergeSnapshot(b, boardSnapshot(a))
  assert.ok(addStrokeChunk(b, {...pen, id: 'new', at: nextRevision(b.revision)}))
})

test('board capacity and repeated chunks remain bounded and immutable', () => {
  const b = createBoard()
  for (let i = 0; i < MAX_STROKES + 100; i++) addStrokeChunk(b, {id: `s${i}`, at: i + 1, color: '#ffffff', size: 1, points: [0, 0]})
  assert.equal(b.strokes.size, MAX_STROKES)
  addStrokeChunk(b, {id: 's0', at: 1, color: '#ffffff', size: 1, offset: 0, points: [1, 1]})
  assert.deepEqual(b.strokes.get('s0').points, [0, 0])
})
