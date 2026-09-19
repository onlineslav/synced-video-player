const test = require('node:test')
const assert = require('node:assert/strict')
const {isNewerVersion, macUpdate} = require('../main/release')

test('versions compare by number, with or without a leading v', () => {
  assert.equal(isNewerVersion('v0.1.5', '0.1.4'), true)
  assert.equal(isNewerVersion('v0.2.0', '0.1.10'), true)
  assert.equal(isNewerVersion('v0.1.10', '0.1.9'), true)
  assert.equal(isNewerVersion('v0.1.4', '0.1.4'), false)
  assert.equal(isNewerVersion('v0.1.3', '0.1.4'), false)
  assert.equal(isNewerVersion('nightly', '0.1.4'), false)
})

const release = {
  tag_name: 'v0.1.5',
  html_url: 'https://github.com/onlineslav/watch-with-friends/releases/tag/v0.1.5',
  assets: [
    {name: 'watch-with-friends-0.1.5-windows-setup.exe', browser_download_url: 'https://github.com/a/windows.exe'},
    {name: 'watch-with-friends-0.1.5-mac-arm64.dmg', browser_download_url: 'https://github.com/a/arm64.dmg'},
    {name: 'watch-with-friends-0.1.5-mac-x64.dmg', browser_download_url: 'https://github.com/a/x64.dmg'},
  ],
}

test("a newer release offers the .dmg for this Mac's chip", () => {
  assert.deepEqual(macUpdate(release, '0.1.4', 'arm64'), {version: '0.1.5', download: 'https://github.com/a/arm64.dmg', page: release.html_url})
  assert.equal(macUpdate(release, '0.1.4', 'x64').download, 'https://github.com/a/x64.dmg')
})

test('nothing is offered when the release is not newer', () => {
  assert.equal(macUpdate(release, '0.1.5', 'arm64'), null)
  assert.equal(macUpdate({...release, prerelease: true}, '0.1.4', 'arm64'), null)
  assert.equal(macUpdate(null, '0.1.4', 'arm64'), null)
})

test('without a matching GitHub download it falls back to the release page', () => {
  assert.equal(macUpdate({...release, assets: []}, '0.1.4', 'arm64').download, release.html_url)
  const elsewhere = {...release, assets: [{name: 'x-mac-arm64.dmg', browser_download_url: 'https://example.com/x.dmg'}]}
  assert.equal(macUpdate(elsewhere, '0.1.4', 'arm64').download, release.html_url)
  assert.equal(macUpdate({...release, html_url: 'https://example.com/'}, '0.1.4', 'arm64'), null)
})
