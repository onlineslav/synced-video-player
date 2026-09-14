const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {prepareProfile, focusWindow} = require('../main/startup')

test('development storage and caches are isolated before requesting the instance lock', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synced-profile-unit-'))
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  const paths = {}
  const profile = path.join(root, 'Synced Video Player Development')
  const app = {
    isPackaged: false,
    getPath(name) {assert.equal(name, 'appData'); return root},
    setPath(name, value) {paths[name] = value},
    requestSingleInstanceLock() {
      assert.deepEqual(paths, {userData: profile, sessionData: profile})
      assert.ok(fs.statSync(profile).isDirectory())
      return true
    },
  }
  assert.equal(prepareProfile(app), true)
})

test('installed builds retain their profile and reject a second instance', () => {
  assert.equal(prepareProfile({
    isPackaged: true,
    getPath() {assert.fail('the installed profile must not change')},
    setPath() {assert.fail('the installed profile must not change')},
    requestSingleInstanceLock: () => false,
  }), false)
})

test('a second launch restores and focuses the existing window', () => {
  const calls = []
  focusWindow({
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  })
  assert.deepEqual(calls, ['restore', 'show', 'focus'])
  focusWindow(null)
  focusWindow({isDestroyed: () => true})
})
