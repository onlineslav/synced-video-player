import test from 'node:test'
import assert from 'node:assert/strict'
import {MAX_NAME_LENGTH, cleanDisplayName, cleanText} from '../renderer/profile.mjs'

test('cleanText caps at the given length', () => {
  assert.equal(cleanText(' The   Long\tTitle ', 8), 'The Long')
  assert.equal(cleanText(undefined, 8), null)
})

test('cleanDisplayName tidies what people type and what peers send', () => {
  assert.equal(cleanDisplayName('  Movie   Night\n'), 'Movie Night')
  assert.equal(cleanDisplayName('a\u202eb\u0007c'), 'abc', 'no bidi overrides or control characters')
  assert.equal(cleanDisplayName('   '), null)
  assert.equal(cleanDisplayName(null), null)
  assert.equal(cleanDisplayName(42), '42')
  assert.equal([...cleanDisplayName('\u{1F3AC}'.repeat(60))].length, MAX_NAME_LENGTH, 'counts characters, not UTF-16 units')
})
