import test from 'node:test'
import assert from 'node:assert/strict'
import {JOIN_WAIT_MS, roomConnection} from '../renderer/connection.mjs'

const waiting = {joining: true, connectedBefore: false, waitingSince: 100, error: null, hasTurn: false}

test('an empty saved room remains usable instead of reporting a failed join', () => {
  const status = roomConnection({...waiting, persistent: true, connectedBefore: true}, 0, JOIN_WAIT_MS * 10)
  assert.equal(status.problem, false)
  assert.match(status.text, /only one here/)
  assert.match(status.detail, /saved/)
  assert.equal(roomConnection({...waiting, persistent: true, error: 'connection failed'}, 0, JOIN_WAIT_MS * 10).problem, true)
})

test('entering a code stays joining until a peer actually connects', () => {
  const joining = roomConnection(waiting, 0, 100)
  assert.match(joining.text, /Connecting/)
  assert.match(joining.detail, /Joining your friend/)
  assert.equal(joining.problem, false)
  assert.equal(roomConnection(waiting, 1, 100).text, 'Friend connected')
})

test('creating a room can wait for an invitation indefinitely', () => {
  const status = roomConnection({...waiting, joining: false}, 0, JOIN_WAIT_MS * 10)
  assert.equal(status.text, 'Waiting for your friend to join…')
  assert.equal(status.problem, false)
})

test('a stalled join explains the missing connection without claiming the code is invalid', () => {
  assert.equal(roomConnection(waiting, 0, 100 + JOIN_WAIT_MS - 1).problem, false)
  const status = roomConnection(waiting, 0, 100 + JOIN_WAIT_MS)
  assert.equal(status.problem, true)
  assert.match(status.detail, /codes match/)
  assert.match(status.detail, /Still trying/)
})

test('a failed WebRTC negotiation explains when a relay is missing or unavailable, on either side', () => {
  for (const joining of [true, false]) {
    const failed = {...waiting, joining, error: 'could not connect to peer abc after exchanging SDP; configure TURN servers'}
    const status = roomConnection(failed, 0, 100)
    assert.equal(status.problem, true)
    assert.match(status.detail, /friend was found/)
    assert.match(status.detail, /configure a TURN relay/)
    assert.match(roomConnection({...failed, hasTurn: true}, 0, 100).detail, /relay may be unavailable/)
  }
})

test('a late connection clears errors and timeout guidance', () => {
  const status = roomConnection({...waiting, error: 'failed'}, 1, JOIN_WAIT_MS * 2)
  assert.equal(status.problem, false)
  assert.equal(status.detail, '')
  assert.equal(status.text, 'Friend connected')
})

test('losing the last peer shows reconnecting for creators and joiners, then reports a delay', () => {
  for (const joining of [true, false]) {
    const lost = {...waiting, joining, connectedBefore: true, waitingSince: 50_000}
    assert.match(roomConnection(lost, 0, 50_000).text, /reconnecting/)
    assert.equal(roomConnection(lost, 0, 50_000 + JOIN_WAIT_MS).problem, true)
    assert.equal(roomConnection(lost, 1, 50_000).text, 'Friend connected')
  }
})
