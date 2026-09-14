// Exercise real Chromium storage in separate processes, with an installed-style
// profile already open. All profiles and identities in this check are temporary.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

if (process.versions.electron) {
  const {app, BrowserWindow} = require('electron')
  const {prepareProfile} = require('../main/startup')
  const [root, kind] = process.argv.slice(2)
  app.setPath('appData', root)
  if (kind === 'installed') {
    const profile = path.join(root, 'Synced Video Player')
    fs.mkdirSync(profile, {recursive: true})
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
  }
  const acquired = kind === 'installed' || prepareProfile(app)
  if (!acquired) {
    console.log('PROFILE_DUPLICATE_REJECTED')
    app.quit()
  } else {
    app.on('second-instance', () => console.log('PROFILE_SECOND_INSTANCE'))
    app.whenReady().then(async () => {
      const win = new BrowserWindow({show: false})
      const started = Date.now()
      await win.loadFile(path.join(root, 'probe.html'))
      const previous = await win.webContents.executeJavaScript('localStorage.getItem("profile-test")')
      assert.equal(previous, null, 'each profile starts with separate storage')
      await win.webContents.executeJavaScript(`localStorage.setItem('profile-test', ${JSON.stringify(kind)})`)
      console.log(`PROFILE_READY ${kind} ${Date.now() - started}ms`)
    }).catch((error) => {console.error(error); app.exit(1)})
  }
} else {
  const {spawn} = require('node:child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synced-profile-check-'))
  fs.writeFileSync(path.join(root, 'probe.html'), '<!doctype html><title>Profile test</title>')
  const env = {...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  const children = []
  function launch(kind) {
    const child = spawn(require('electron'), [__filename, root, kind], {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
    child.output = ''
    child.stdout.on('data', (data) => {child.output += data})
    child.stderr.on('data', (data) => {child.output += data})
    child.on('error', (error) => {child.output += error.message})
    children.push(child)
    return child
  }
  async function expect(child, message) {
    const started = Date.now()
    while (Date.now() - started < 4000) {
      if (child.output.includes(message)) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.fail(`Expected ${message}\n${child.output}`)
  }
  ;(async () => {
    try {
      const installed = launch('installed')
      await expect(installed, 'PROFILE_READY installed')
      const development = launch('development')
      await expect(development, 'PROFILE_READY development')
      assert.ok(!development.output.includes('Unable to create cache'), development.output)
      console.log('PASS: Development opens separate local storage while the installed profile is in use')
      console.log(development.output.match(/PROFILE_READY[^\r\n]+/)[0])
      const duplicate = launch('development')
      await expect(duplicate, 'PROFILE_DUPLICATE_REJECTED')
      await expect(development, 'PROFILE_SECOND_INSTANCE')
      console.log('PASS: A duplicate development launch notifies the existing instance and exits before opening storage')
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill()
    }
  })().catch((error) => {console.error(error); process.exitCode = 1})
}
