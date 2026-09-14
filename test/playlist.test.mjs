import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DRAWER,
  addItem,
  clampDrag,
  createPlaylist,
  draggedWidth,
  dropIndex,
  slotShift,
  endPosition,
  maxDrawerWidth,
  mergePlaylist,
  moveItem,
  nextItem,
  orderedItems,
  playlistSnapshot,
  positionAt,
  removeItem,
  settledWidth,
} from '../renderer/playlist.mjs'

const item = (fields) => ({id: 'a', title: 'Film.mkv', position: 1, ownerName: 'Sam', ...fields})
const ids = (list) => orderedItems(list).map((i) => i.id)
const listOf = (...names) => {
  const list = createPlaylist()
  names.forEach((id, i) => addItem(list, item({id, position: i + 1}), 'p1'))
  return list
}

test('addItem keeps the sender as owner and rejects malformed items', () => {
  const list = createPlaylist()
  assert.deepEqual(addItem(list, item({title: '  Film.mkv '}), 'peer1'), {
    id: 'a', title: 'Film.mkv', position: 1, owner: 'peer1', ownerName: 'Sam', movedAt: 0, movedBy: '',
  })
  assert.equal(addItem(list, item(), 'peer2'), null, 'already there')
  assert.equal(addItem(list, item({id: 'b', title: '   '}), 'peer1'), null)
  assert.equal(addItem(list, item({id: 'c', position: 'last'}), 'peer1'), null)
  assert.equal(addItem(list, item({id: 42}), 'peer1'), null)
  assert.equal(addItem(list, item({id: 'd'}), undefined), null)
  assert.equal(addItem(list, item({id: 'e', title: 'x'.repeat(500)}), 'peer1').title.length, 200)
  assert.equal(list.items.size, 2)
  assert.equal(endPosition(list), 2)
  assert.equal(endPosition(createPlaylist()), 1)
})

test('removed items never come back from an older snapshot', () => {
  const a = listOf('one', 'two')
  const stale = playlistSnapshot(a)
  removeItem(a, 'one')
  mergePlaylist(a, stale)
  assert.deepEqual(ids(a), ['two'])
})

test('a joining peer merges everyone’s snapshots into the same list', () => {
  const a = createPlaylist()
  addItem(a, item({id: 'x', position: 3}), 'p1')
  addItem(a, item({id: 'y', position: 1}), 'p2')
  removeItem(a, 'gone')
  const b = createPlaylist()
  addItem(b, item({id: 'gone', position: 0}), 'p3')
  addItem(b, item({id: 'z', position: 2}), 'p3')
  addItem(b, item({id: 'x', position: 3}), 'p1')
  moveItem(b, {id: 'x', position: 0.5, movedAt: 10, movedBy: 'p3'}) // a hasn't seen this move

  const joiner = createPlaylist()
  mergePlaylist(joiner, playlistSnapshot(a))
  mergePlaylist(joiner, playlistSnapshot(b))
  mergePlaylist(joiner, playlistSnapshot(a))
  assert.deepEqual(orderedItems(joiner).map((i) => [i.id, i.owner]), [['x', 'p1'], ['y', 'p2'], ['z', 'p3']])
  mergePlaylist(joiner, {items: 'nope', removed: [null]})
  mergePlaylist(joiner, {items: [null, 7]})
})

test('positionAt places an item between its new neighbours', () => {
  const list = listOf('a', 'b', 'c', 'd')
  const move = (id, index, movedAt) => moveItem(list, {id, position: positionAt(list, id, index), movedAt, movedBy: 'p1'})
  assert.equal(positionAt(list, 'b', 1), null, 'already there')
  assert.equal(positionAt(list, 'missing', 0), null)
  move('d', 0, 1)
  assert.deepEqual(ids(list), ['d', 'a', 'b', 'c'])
  move('d', 3, 2)
  assert.deepEqual(ids(list), ['a', 'b', 'c', 'd'])
  move('a', 2, 3)
  assert.deepEqual(ids(list), ['b', 'c', 'a', 'd'])
  move('a', 99, 4)
  assert.deepEqual(ids(list), ['b', 'c', 'd', 'a'])
})

test('the latest move wins, even when moves arrive out of order or before the item', () => {
  const list = listOf('a', 'b', 'c')
  assert.ok(moveItem(list, {id: 'a', position: 10, movedAt: 5, movedBy: 'p1'}))
  assert.ok(!moveItem(list, {id: 'a', position: 0, movedAt: 4, movedBy: 'p9'}), 'older')
  assert.ok(moveItem(list, {id: 'a', position: 2.5, movedAt: 5, movedBy: 'p2'}), 'same time, higher peer id')
  assert.deepEqual(ids(list), ['b', 'a', 'c'])
  assert.ok(!moveItem(list, {id: 'a', position: Infinity, movedAt: 9, movedBy: 'p1'}))
  assert.ok(!moveItem(list, {id: 'a', position: 1, movedAt: 9, movedBy: ''}))

  assert.ok(!moveItem(list, {id: 'late', position: 0, movedAt: 7, movedBy: 'p2'}))
  addItem(list, item({id: 'late', position: 4}), 'p3')
  assert.equal(ids(list)[0], 'late')
  removeItem(list, 'gone')
  moveItem(list, {id: 'gone', position: 0, movedAt: 8, movedBy: 'p2'})
  assert.equal(list.pendingMoves.size, 0)
})

test('nextItem skips unplayable items and follows moves and removals', () => {
  const list = createPlaylist()
  for (const [id, position, owner] of [['a', 1, 'me'], ['b', 2, 'left'], ['c', 3, 'me'], ['d', 3, 'me']]) addItem(list, item({id, position}), owner)
  const playable = (i) => i.owner === 'me'
  assert.equal(nextItem(list, {id: 'a', position: 1}, playable).id, 'c')
  assert.equal(nextItem(list, {id: 'c', position: 3}, playable).id, 'd', 'same position, ordered by id')
  moveItem(list, {id: 'a', position: 3.5, movedAt: 1, movedBy: 'p1'})
  assert.equal(nextItem(list, {id: 'a', position: 1}, playable), null, 'the playing item moved to the end')
  removeItem(list, 'c')
  assert.equal(nextItem(list, {id: 'c', position: 3}, playable).id, 'd')
  assert.equal(nextItem(list, null), null)
})

test('a dragged row lands in the nearest slot while the rows in between slide aside', () => {
  const tops = [0, 40, 80, 120]
  assert.equal(clampDrag(tops, 1, 500), 80, 'no further than the last row')
  assert.equal(clampDrag(tops, 1, -500), -40, 'no further than the first row')
  assert.equal(dropIndex(tops, 1, 19), 1)
  assert.equal(dropIndex(tops, 1, 21), 2, 'switches halfway to the next slot')
  assert.equal(dropIndex(tops, 1, -25), 0)
  assert.deepEqual(tops.map((_, i) => slotShift(tops, i, 1, 3)), [0, 0, -40, -40], 'dragged down: rows below move up')
  assert.deepEqual(tops.map((_, i) => slotShift(tops, i, 3, 1)), [0, 40, 40, 0], 'dragged up: rows above move down')
  assert.deepEqual(tops.map((_, i) => slotShift(tops, i, 2, 2)), [0, 0, 0, 0])
})

test('the drawer follows the drag and settles open or closed', () => {
  assert.equal(maxDrawerWidth(1280), DRAWER.maxWidth)
  assert.equal(maxDrawerWidth(720), 320)
  assert.equal(maxDrawerWidth(500), DRAWER.minWidth)
  assert.equal(draggedWidth(0, -150, 480), 150, 'dragging left pulls it out')
  assert.equal(draggedWidth(300, 400, 480), 0)
  assert.equal(draggedWidth(300, -900, 480), 480)
  assert.equal(settledWidth(100, 480), 0)
  assert.equal(settledWidth(150, 480), DRAWER.minWidth)
  assert.equal(settledWidth(350, 480), 350)
})
