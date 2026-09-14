import test from 'node:test'
import assert from 'node:assert/strict'
import {addStrokeChunk, boardSnapshot, clearBoard, createBoard, drawStroke, ERASER, mergeSnapshot, pictureRect} from '../renderer/whiteboard.mjs'

const chunk = (fields) => ({id: 'a', color: '#ffffff', size: 1, at: 100, offset: 0, points: [0.1, 0.1], ...fields})

test('stroke chunks append in place and repeats change nothing', () => {
  const board = createBoard()
  addStrokeChunk(board, chunk())
  addStrokeChunk(board, chunk({offset: 2, points: [0.2, 0.2, 0.3, 0.3]}))
  addStrokeChunk(board, chunk({offset: 2, points: [0.2, 0.2]}))
  assert.deepEqual(board.strokes.get('a').points, [0.1, 0.1, 0.2, 0.2, 0.3, 0.3])
  assert.equal(addStrokeChunk(board, chunk({offset: 10, points: [1, 1]})), null, 'gap')
})

test('addStrokeChunk rejects malformed input from peers', () => {
  const board = createBoard()
  assert.equal(addStrokeChunk(board, chunk({color: 'red; background: url(x)'})), null)
  assert.equal(addStrokeChunk(board, chunk({size: 'length'})), null)
  assert.equal(addStrokeChunk(board, chunk({size: 9})), null)
  assert.equal(addStrokeChunk(board, chunk({points: [0.1]})), null)
  assert.equal(addStrokeChunk(board, chunk({points: [0.1, 'x']})), null)
  assert.equal(board.strokes.size, 0)
  assert.ok(addStrokeChunk(board, chunk({color: ERASER})), 'eraser strokes are allowed')
})

test('eraser strokes cut out what is under them and pen strokes draw normally again', () => {
  const calls = []
  const ctx = new Proxy({}, {get: (_t, name) => (...args) => calls.push([name, ...args]), set: (_t, name, value) => calls.push([name, value])})
  const rect = {x: 0, y: 0, width: 100, height: 100}
  drawStroke(ctx, {color: ERASER, size: 0, points: [0, 0, 1, 1]}, rect)
  drawStroke(ctx, {color: '#ffffff', size: 0, points: [0, 0, 1, 1]}, rect)
  assert.deepEqual(calls.filter(([name]) => ['globalCompositeOperation', 'lineWidth'].includes(name)), [
    ['globalCompositeOperation', 'destination-out'],
    ['lineWidth', 1.2],
    ['globalCompositeOperation', 'source-over'],
    ['lineWidth', 1],
  ])
})

test('clearing removes strokes started before it, including ones still being drawn', () => {
  const board = createBoard()
  addStrokeChunk(board, chunk({id: 'old', at: 100}))
  addStrokeChunk(board, chunk({id: 'new', at: 300}))
  clearBoard(board, 200)
  assert.deepEqual([...board.strokes.keys()], ['new'])
  assert.equal(addStrokeChunk(board, chunk({id: 'old', at: 100, offset: 2})), null)
})

test('a joining peer merges everyone’s snapshots into the same board', () => {
  const a = createBoard()
  addStrokeChunk(a, chunk({id: 's1', at: 300, points: [0, 0, 1, 1]}))
  clearBoard(a, 200)
  const b = createBoard()
  addStrokeChunk(b, chunk({id: 's1', at: 300, points: [0, 0]})) // b saw less of s1
  addStrokeChunk(b, chunk({id: 'stale', at: 150}))

  const joiner = createBoard()
  mergeSnapshot(joiner, boardSnapshot(b))
  mergeSnapshot(joiner, boardSnapshot(a))
  mergeSnapshot(joiner, boardSnapshot(a))
  assert.deepEqual([...joiner.strokes.keys()], ['s1'])
  assert.deepEqual(joiner.strokes.get('s1').points, [0, 0, 1, 1])
  mergeSnapshot(joiner, {strokes: 'nope'})
})

test('pictureRect letterboxes the video inside the stage', () => {
  assert.deepEqual(pictureRect(960, 1000, 1920, 1080), {x: 0, y: 230, width: 960, height: 540})
  assert.deepEqual(pictureRect(1000, 540, 1920, 1080), {x: 20, y: 0, width: 960, height: 540})
  assert.deepEqual(pictureRect(800, 600, 0, 0), {x: 0, y: 0, width: 800, height: 600})
})

test('drawStroke continues from the previous point and scales to the picture', () => {
  const calls = []
  const ctx = new Proxy({}, {get: (_t, name) => (...args) => calls.push([name, ...args]), set: (_t, name, value) => calls.push([name, value])})
  const stroke = {color: '#ffffff', size: 3, points: [0, 0, 0.5, 0.5, 1, 1]}
  drawStroke(ctx, stroke, {x: 10, y: 0, width: 100, height: 50}, 4)
  assert.deepEqual(calls.filter(([name]) => ['moveTo', 'lineTo', 'lineWidth'].includes(name)), [
    ['lineWidth', 1.6],
    ['moveTo', 60, 25],
    ['lineTo', 110, 50],
  ])
})
