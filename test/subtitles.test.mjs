import test from 'node:test'
import assert from 'node:assert/strict'
import {activeCues, captionHtml, cueHtml} from '../renderer/subtitles.mjs'

test('cueHtml keeps basic styling and escapes everything else', () => {
  assert.equal(cueHtml('<i>Hi</i> & <b class="x">bye</b>'), '<i>Hi</i> &#38; <b>bye</b>')
  assert.equal(cueHtml('<script>alert(1)</script>\n<font color="red">x</font>'), 'alert(1)<br>x')
  assert.equal(cueHtml('Tom &amp; Jerry &lt;3'), 'Tom &#38; Jerry &#60;3')
  assert.equal(cueHtml('<img src=x onerror=alert(1)>"q"'), '&#34;q&#34;')
})

test('activeCues and captionHtml show every cue on screen at a time', () => {
  const cues = [
    {start: 1, end: 3, text: 'one'},
    {start: 2, end: 4, text: 'two'},
  ]
  assert.deepEqual(activeCues(cues, 0.5), [])
  assert.equal(captionHtml(cues, 2.5), 'one<br>two')
  assert.equal(captionHtml(cues, 3), 'two', 'end is exclusive')
})
