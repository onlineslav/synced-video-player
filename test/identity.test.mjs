import test from 'node:test'
import assert from 'node:assert/strict'
import {createIdentity, isValidIdentity, normalizeUsername, usernameFor} from '../renderer/identity.mjs'

test('a username is a stable hash of the public key', async () => {
  const a = await createIdentity()
  const b = await createIdentity()
  assert.match(a.username, /^[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/)
  assert.equal(await usernameFor({...a.publicKey}), a.username)
  assert.notEqual(a.username, b.username)
  assert.ok(await isValidIdentity(a))
  assert.ok(!(await isValidIdentity({...a, username: b.username})), 'username must match the key')
  assert.ok(!(await isValidIdentity({username: 'x'})))
})

test('normalizeUsername accepts sloppy typing and rejects non-usernames', () => {
  assert.equal(normalizeUsername(' K7QM X3PA TRB2 '), 'k7qm-x3pa-trb2')
  assert.equal(normalizeUsername('k7qm-x3pa-trbI'), 'k7qm-x3pa-trb1', 'I and L read as 1')
  assert.equal(normalizeUsername('k7qm-x3pa-trbo'), 'k7qm-x3pa-trb0', 'O reads as 0')
  assert.equal(normalizeUsername('k7qm-x3pa-trbu'), null, 'u is not in the alphabet')
  assert.equal(normalizeUsername('k7qm-x3pa'), null)
  assert.equal(normalizeUsername(undefined), null)
})
