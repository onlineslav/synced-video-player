const test = require('node:test')
const assert = require('node:assert/strict')
const {createIceLoader, validatePublicConfig, cleanIceServers} = require('../main/turn')
const servers = [{urls: 'turn:relay.test:3478', username: 'short-lived', credential: 'temporary'}]

test('build configuration rejects minting secrets and static credentials', () => {
  assert.throws(() => validatePublicConfig({cloudflare: {apiToken: 'secret'}}), /Do not package/)
  assert.throws(() => validatePublicConfig({iceServers: servers}), /Do not package/)
  assert.throws(() => validatePublicConfig({endpoint: 'http://example.test'}), /HTTPS/)
  assert.deepEqual(validatePublicConfig({endpoint: 'https://relay.test/credentials'}), {endpoint: 'https://relay.test/credentials'})
  assert.throws(() => cleanIceServers([{urls: 'https://wrong.test'}]), /Invalid relay URL/)
})

test('credential requests are shared, cached, and renewed before expiry', async () => {
  let now = 0, requests = 0
  const loader = createIceLoader({readFile: async () => JSON.stringify({endpoint: 'https://relay.test'}), now: () => now,
    fetchImpl: async () => { requests++; return Response.json({iceServers: servers, expiresAt: now + 3600000}) }})
  const [a, b] = await Promise.all([loader('test'), loader('test')])
  assert.equal(requests, 1)
  assert.deepEqual(a, b)
  await loader('test'); assert.equal(requests, 1)
  now = 3500000
  await loader('test'); assert.equal(requests, 2)
})

test('a stalled service settles with an explicit error and can recover', async () => {
  let hanging = true
  const loader = createIceLoader({readFile: async () => '{"endpoint":"https://relay.test"}', timeoutMs: 10,
    fetchImpl: async () => hanging ? new Promise(() => {}) : Response.json({iceServers: servers, expiresAt: Date.now() + 3600000})})
  assert.match((await loader('test')).error, /timed out/)
  hanging = false
  assert.equal((await loader('test')).error, undefined)
})

test('an outage keeps valid cached credentials and rejects expired responses', async () => {
  let now = 0, fail = false
  const loader = createIceLoader({readFile: async () => '{"endpoint":"https://relay.test"}', now: () => now,
    fetchImpl: async () => fail ? Response.json({}, {status: 503}) : Response.json({iceServers: servers, expiresAt: 3600000})})
  await loader('test')
  now = 3500000; fail = true
  const result = await loader('test')
  assert.ok(result.iceServers.length)
  assert.match(result.error, /503/)
  now = 3700000
  assert.equal((await loader('test')).iceServers.length, 0)
})
