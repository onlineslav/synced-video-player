import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTime,
  generateRoomCode,
  isImageMime,
  isImagePath,
  isNewerClaim,
  normalizeRoomCode,
  preferHighStartBitrate,
  preferStereoOpus,
} from '../renderer/lib.mjs'

test('isImagePath and isImageMime recognise pictures that can be shared', () => {
  assert.ok(isImagePath('C:\\Photos\\Cat.JPG'))
  assert.ok(isImagePath('/scans/page.tiff'))
  assert.ok(!isImagePath('movie.mkv'))
  assert.ok(!isImagePath('C:\\folder.png\\notes'))
  assert.ok(!isImagePath('odd.constructor'))
  assert.ok(isImageMime('image/webp'))
  assert.ok(!isImageMime('image/svg+xml'))
  assert.ok(!isImageMime(undefined))
})

test('preferHighStartBitrate adds the hint to video codecs, with or without an fmtp line', () => {
  const sdp = [
    'm=video 9 UDP/TLS/RTP/SAVPF 96 98',
    'a=rtpmap:96 VP8/90000',
    'a=rtcp-fb:96 nack',
    'a=rtpmap:98 VP9/90000',
    'a=fmtp:98 profile-id=0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    '',
  ].join('\r\n')
  const out = preferHighStartBitrate(sdp, 5000)
  assert.ok(out.includes('a=rtpmap:96 VP8/90000\r\na=fmtp:96 x-google-start-bitrate=5000\r\n'))
  assert.ok(out.includes('a=fmtp:98 profile-id=0;x-google-start-bitrate=5000\r\n'))
  assert.ok(out.includes('a=fmtp:111 minptime=10\r\n'))
  assert.equal(preferHighStartBitrate(out, 5000), out)
})

test('room codes survive being typed back in any format', () => {
  const code = generateRoomCode()
  assert.match(code, /^[A-Z2-9]{8}$/)
  assert.equal(normalizeRoomCode(` ${code.slice(0, 4).toLowerCase()} - ${code.slice(4)} `), code)
})

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(65.9), '1:05')
  assert.equal(formatTime(3725), '1:02:05')
})

test('isNewerClaim breaks ties by host id', () => {
  assert.ok(isNewerClaim({claimedAt: 2, hostId: 'a'}, {claimedAt: 1, hostId: 'b'}))
  assert.ok(isNewerClaim({claimedAt: 1, hostId: 'b'}, {claimedAt: 1, hostId: 'a'}))
  assert.ok(!isNewerClaim({claimedAt: 1, hostId: 'a'}, {claimedAt: 1, hostId: 'b'}))
})

test('preferStereoOpus rewrites only the opus fmtp line', () => {
  const sdp = [
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1;stereo=0',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
    '',
  ].join('\r\n')
  const out = preferStereoOpus(sdp)
  assert.ok(out.includes('a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=510000\r\n'))
  assert.ok(out.includes('a=fmtp:63 111/111\r\n'))
})
