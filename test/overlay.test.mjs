import test from 'node:test'
import assert from 'node:assert/strict'
import {averageLuminance, sourceRegion, toneFor} from '../renderer/overlay.mjs'

test('sourceRegion maps a box on the stage to media pixels', () => {
  const rect = {x: 0, y: 100, width: 960, height: 540} // 1920x1080 letterboxed
  assert.deepEqual(sourceRegion({x: 932, y: 340, width: 28, height: 60}, rect, 1920, 1080), {sx: 1864, sy: 480, sw: 56, sh: 120})
  assert.deepEqual(sourceRegion({x: 932, y: 620, width: 28, height: 60}, rect, 1920, 1080), {sx: 1864, sy: 1040, sw: 56, sh: 40}, 'clipped')
  assert.equal(sourceRegion({x: 932, y: 20, width: 28, height: 60}, rect, 1920, 1080), null, 'over the letterbox')
  assert.equal(sourceRegion({x: 0, y: 0, width: 10, height: 10}, rect, 0, 0), null)
})

test('averageLuminance weighs colour and transparency', () => {
  assert.equal(averageLuminance(new Uint8ClampedArray([255, 255, 255, 255])), 1)
  assert.equal(averageLuminance(new Uint8ClampedArray([255, 255, 255, 0])), 0)
  assert.equal(averageLuminance(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])), 0.5)
  assert.ok(averageLuminance(new Uint8ClampedArray([0, 255, 0, 255])) > averageLuminance(new Uint8ClampedArray([0, 0, 255, 255])))
  assert.equal(averageLuminance(new Uint8ClampedArray()), 0)
})

test('toneFor switches to black over bright pictures and holds steady over grey', () => {
  assert.equal(toneFor(0.9), 'dark')
  assert.equal(toneFor(0.1, 'dark'), 'light')
  assert.equal(toneFor(0.55, 'dark'), 'dark')
  assert.equal(toneFor(0.55, 'light'), 'light')
})
