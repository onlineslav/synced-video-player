import test from 'node:test'
import assert from 'node:assert/strict'
import {createIdentity, createKeys, isValidIdentity, normalizeHandle, normalizeUsername, usernameFor} from '../renderer/identity.mjs'

const USERNAME = /^[a-z0-9_.]{3,20}#[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/

test('a username is the chosen handle plus a tag hashed from the handle and key', async () => {
  const keys = await createKeys()
  const a = await createIdentity('jeromy', keys)
  const b = await createIdentity('jeromy')
  assert.match(a.username, USERNAME)
  assert.ok(a.username.startsWith('jeromy#'))
  assert.equal(await usernameFor(keys.publicKey, 'jeromy'), a.username, 'the welcome screen preview matches')
  assert.notEqual(a.username, b.username, 'same handle, different people')
  assert.notEqual((await createIdentity('jeromy2', keys)).username.split('#')[1], a.username.split('#')[1], 'tag depends on the handle')
  assert.ok(await isValidIdentity(a))
  assert.ok(!(await isValidIdentity({...a, username: b.username})), 'username must match the key')
  assert.ok(!(await isValidIdentity({...a, handle: 'someone'})), 'and the handle')
  assert.ok(!(await isValidIdentity({username: 'k7qm-x3pa-trb2'})), 'identities from before handles')
})

test('normalizeHandle', () => {
  assert.equal(normalizeHandle('  Jeromy_D.  '), 'jeromy_d.')
  assert.equal(normalizeHandle('jd'), null, 'too short')
  assert.equal(normalizeHandle('a'.repeat(21)), null, 'too long')
  assert.equal(normalizeHandle('j d!'), null)
})

test('normalizeUsername accepts sloppy typing and rejects non-usernames', () => {
  assert.equal(normalizeUsername(' Jeromy # K7QM X3PA '), 'jeromy#k7qm-x3pa')
  assert.equal(normalizeUsername('jeromy#k7qm-x3pI'), 'jeromy#k7qm-x3p1', 'I and L read as 1')
  assert.equal(normalizeUsername('jeromy#k7qm-x3pO'), 'jeromy#k7qm-x3p0', 'O reads as 0')
  assert.equal(normalizeUsername('jeromy#k7qm-x3pu'), null, 'u is not in the alphabet')
  assert.equal(normalizeUsername('jeromy#k7qm'), null)
  assert.equal(normalizeUsername('k7qm-x3pa-trb2'), null, 'no handle')
  assert.equal(normalizeUsername('a#b#c'), null)
  assert.equal(normalizeUsername(undefined), null)
})
