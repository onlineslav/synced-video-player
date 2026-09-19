import test from 'node:test'
import assert from 'node:assert/strict'
import {ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, clampZoom, stepZoom, parseZoom, zoomPercent, formatZoom} from '../renderer/zoom.mjs'
import {zoomDirection, zoomFactor, watchZoom} from '../main/zoom.js'

test('100% is a step, and the steps stay inside the range', () => {
  assert.ok(ZOOM_STEPS.includes(DEFAULT_ZOOM))
  assert.equal(ZOOM_STEPS[0], MIN_ZOOM)
  assert.equal(ZOOM_STEPS[ZOOM_STEPS.length - 1], MAX_ZOOM)
})

test('clampZoom holds the range and keeps 1% precision', () => {
  assert.equal(clampZoom(0.1), MIN_ZOOM)
  assert.equal(clampZoom(9), MAX_ZOOM)
  assert.equal(clampZoom(1.123), 1.12)
  assert.equal(clampZoom('1.25'), 1.25)
})

test('clampZoom keeps a typed value that is not a step', () => {
  assert.equal(clampZoom(1.33), 1.33)
})

test('clampZoom falls back to 100% for nonsense', () => {
  for (const value of [null, undefined, '', 'big', NaN, -2, {}]) assert.equal(clampZoom(value), DEFAULT_ZOOM)
})

test('parseZoom reads what someone types in the percent box', () => {
  assert.equal(parseZoom('125'), 1.25)
  assert.equal(parseZoom('125%'), 1.25)
  assert.equal(parseZoom(' 125 % '), 1.25)
  assert.equal(parseZoom('133'), 1.33)
  assert.equal(parseZoom('500'), MAX_ZOOM)
  assert.equal(parseZoom('10'), MIN_ZOOM)
})

test('parseZoom reads a small number as a factor, so 1.5 is 150%', () => {
  assert.equal(parseZoom('1.5'), 1.5)
  assert.equal(parseZoom('2'), 2)
})

test('parseZoom refuses what is not a number yet', () => {
  for (const text of ['', '%', '-', 'abc', '0']) assert.equal(parseZoom(text), null)
})

test('stepZoom jumps to the next step from wherever the slider left it', () => {
  assert.equal(stepZoom(1, 1), 1.1)
  assert.equal(stepZoom(1, -1), 0.9)
  assert.equal(stepZoom(1.12, 1), 1.25)
  assert.equal(stepZoom(1.12, -1), 1.1)
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM)
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM)
})

test('stepZoom with no direction resets', () => {
  assert.equal(stepZoom(1.75, 0), DEFAULT_ZOOM)
})

test('percentages read the way they are shown', () => {
  assert.equal(zoomPercent(1.1), 110)
  assert.equal(formatZoom(1), '100%')
  assert.equal(formatZoom(0.67), '67%')
  assert.equal(formatZoom(1.75), '175%')
})

// The bug this fixes: Ctrl+= has to zoom in, not only Ctrl+Shift+= (the "+" the default menu wants).
test('zoomDirection reads every way of asking', () => {
  const key = (over) => ({type: 'keyDown', control: true, alt: false, meta: false, key: '', code: '', ...over})
  assert.equal(zoomDirection(key({key: '='})), 1)
  assert.equal(zoomDirection(key({key: '+'})), 1)
  assert.equal(zoomDirection(key({key: '+', code: 'NumpadAdd'})), 1)
  assert.equal(zoomDirection(key({key: '-'})), -1)
  assert.equal(zoomDirection(key({key: '_'})), -1)
  assert.equal(zoomDirection(key({key: '0'})), 0)
})

test('zoomDirection ignores keys that are not a zoom request', () => {
  const key = (over) => ({type: 'keyDown', control: true, alt: false, meta: false, key: '', code: '', ...over})
  assert.equal(zoomDirection(key({key: 'a'})), null)
  assert.equal(zoomDirection(key({key: '=', control: false})), null)
  assert.equal(zoomDirection(key({key: '=', alt: true})), null)
  assert.equal(zoomDirection(key({key: '=', type: 'keyUp'})), null)
})

test('zoomFactor refuses a value that would make the window unusable', () => {
  assert.equal(zoomFactor(99), 3)
  assert.equal(zoomFactor(0), 1)
  assert.equal(zoomFactor('nope'), 1)
  assert.equal(zoomFactor(1.25), 1.25)
})

test('watchZoom sends a step and stops the menu accelerator', () => {
  const handlers = {}
  const sent = []
  let prevented = 0
  watchZoom({on: (name, fn) => (handlers[name] = fn), send: (...args) => sent.push(args)})

  handlers['before-input-event']({preventDefault: () => prevented++}, {type: 'keyDown', control: true, key: '='})
  handlers['before-input-event']({preventDefault: () => prevented++}, {type: 'keyDown', control: true, key: 'a'})
  handlers['zoom-changed']({}, 'out')

  assert.deepEqual(sent, [['zoom:step', 1], ['zoom:step', -1]])
  assert.equal(prevented, 1)
})
