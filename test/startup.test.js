const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {prepareProfile, focusWindow, carryOverProfile} = require('../main/startup')

const tempRoot = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wwf-profile-unit-'))
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  return root
}

test('development storage and caches are isolated before requesting the instance lock', (t) => {
  const root = tempRoot(t)
  const paths = {}
  const profile = path.join(root, 'Watch With Friends Development')
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

test('an installed build keeps its own profile and rejects a second instance', (t) => {
  const root = tempRoot(t)
  const profile = path.join(root, 'Watch With Friends')
  assert.equal(prepareProfile({
    isPackaged: true,
    getPath: (name) => (name === 'appData' ? root : profile),
    setPath() {assert.fail('the installed profile must not change')},
    requestSingleInstanceLock: () => false,
  }), false)
})

test('the previous name’s profile is carried over once, without its caches', (t) => {
  const root = tempRoot(t)
  const from = path.join(root, 'Synced Video Player')
  const to = path.join(root, 'Watch With Friends')
  fs.mkdirSync(path.join(from, 'Local Storage', 'leveldb'), {recursive: true})
  fs.writeFileSync(path.join(from, 'Local Storage', 'leveldb', '000003.log'), 'identity')
  fs.mkdirSync(path.join(from, 'Cache'), {recursive: true})
  fs.writeFileSync(path.join(from, 'Cache', 'data_0'), 'disposable')

  assert.equal(carryOverProfile(from, to), true)
  assert.equal(fs.readFileSync(path.join(to, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'identity')
  assert.ok(!fs.existsSync(path.join(to, 'Cache')), 'caches are not worth copying')

  // Once is enough: a profile the person cleared out must stay cleared.
  fs.rmSync(path.join(to, 'Local Storage'), {recursive: true})
  assert.equal(carryOverProfile(from, to), false)
  assert.ok(!fs.existsSync(path.join(to, 'Local Storage')))
})

test('a profile that already holds data is never overwritten', (t) => {
  const root = tempRoot(t)
  const from = path.join(root, 'Synced Video Player')
  const to = path.join(root, 'Watch With Friends')
  fs.mkdirSync(from, {recursive: true})
  fs.writeFileSync(path.join(from, 'old'), 'old')
  fs.mkdirSync(to, {recursive: true})
  fs.writeFileSync(path.join(to, 'new'), 'new')

  assert.equal(carryOverProfile(from, to), false)
  assert.ok(!fs.existsSync(path.join(to, 'old')))
  assert.equal(fs.readFileSync(path.join(to, 'new'), 'utf8'), 'new')
})

test('nothing to carry over leaves a first launch alone', (t) => {
  const root = tempRoot(t)
  const to = path.join(root, 'Watch With Friends')
  fs.mkdirSync(to, {recursive: true})
  assert.equal(carryOverProfile(path.join(root, 'Synced Video Player'), to), false)
  assert.deepEqual(fs.readdirSync(to), [])
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
