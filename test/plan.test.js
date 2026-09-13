const test = require('node:test')
const assert = require('node:assert/strict')
const {escapeFilterValue, isSubtitleSidecar, planSession, summarizeProbe} = require('../main/plan')

const probe = {
  format: {duration: '5400.5', tags: {title: 'Movie'}},
  streams: [
    {index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: {attached_pic: 1}},
    {index: 1, codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p10le', width: 3840, height: 2160, color_transfer: 'smpte2084'},
    {index: 2, codec_type: 'audio', codec_name: 'dts', channels: 6, tags: {language: 'eng'}, disposition: {default: 1}},
    {index: 3, codec_type: 'subtitle', tags: {language: 'jpn'}},
    {index: 4, codec_type: 'subtitle', codec_name: 'ass', tags: {language: 'eng', title: 'Full'}},
    {index: 5, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', tags: {language: 'eng'}},
  ],
}

const media = summarizeProbe(probe, ['C:\\Movies\\movie.en.srt'])
const allSupported = {h264: true, hevc: true, av1: true, vp9: true}
const media8Bit = summarizeProbe({
  ...probe,
  streams: probe.streams.map((s) => (s.index === 1 ? {...s, pix_fmt: 'yuv420p', color_transfer: undefined} : s)),
})

test('summarizeProbe skips cover art and keeps ffmpeg subtitle indexes', () => {
  assert.equal(media.duration, 5400.5)
  assert.equal(media.video.index, 1)
  assert.deepEqual(media.audio, [{index: 2, label: 'ENG · dts 6ch', isDefault: true}])
  assert.deepEqual(
    media.subtitles.map((s) => [s.id, s.image]),
    [['embedded:1', false], ['embedded:2', true], ['external:C:\\Movies\\movie.en.srt', false]],
  )
})

test('passes supported 8-bit video through and seeks to the keyframe', () => {
  const plan = planSession({media: media8Bit, filePath: 'C:\\Movies\\movie.mkv', start: 100, keyframe: 97.5, audioIndex: 2, support: allSupported})
  assert.equal(plan.transcoding, false)
  assert.equal(plan.offset, 97.5)
  assert.equal(plan.mime, 'video/mp4; codecs="hvc1.1.6.L153.B0,mp4a.40.2"')
  assert.deepEqual(plan.args.slice(3, 7), ['-ss', '97.700', '-i', 'C:\\Movies\\movie.mkv'])
  assert.ok(plan.args.includes('copy'))
})

test('transcodes 10-bit video even when Chromium can decode it, and tonemaps HDR', () => {
  const plan = planSession({media, filePath: 'movie.mkv', start: 100, keyframe: 97.5, support: allSupported, encoder: 'h264_nvenc', canTonemap: true})
  assert.equal(plan.transcoding, true)
  assert.equal(plan.offset, 100)
  const vf = plan.args[plan.args.indexOf('-vf') + 1]
  assert.match(vf, /^zscale=t=linear/)
  assert.match(vf, /format=nv12$/)
  assert.ok(plan.args.includes('h264_nvenc'))
})

test('burns external text subtitles using a relative, escaped filename', () => {
  const file = "C:\\Movies\\weird name, [x] 'q'; plain.srt"
  const withSub = summarizeProbe(probe, [file])
  const plan = planSession({media: withSub, filePath: 'C:\\Movies\\movie.mkv', subtitleId: `external:${file}`, support: allSupported})
  assert.equal(plan.cwd, 'C:\\Movies\\')
  assert.ok(plan.args.includes('-copyts'))
  assert.match(plan.args[plan.args.indexOf('-vf') + 1], /subtitles=filename=weird name\\, \\\[x\\\]/)
})

test('overlays image subtitles through filter_complex', () => {
  const plan = planSession({media, filePath: 'movie.mkv', subtitleId: 'embedded:2', support: allSupported})
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]
  assert.match(graph, /\[base\]\[0:s:2\]overlay/)
  assert.equal(plan.args[plan.args.indexOf('-map') + 1], '[vout]')
})

test('escapeFilterValue escapes for both filter-graph levels', () => {
  assert.equal(escapeFilterValue("a, [b] 'c'; d:e"), String.raw`a\, \[b\] \\\'c\\\'\; d\\:e`)
})

test('isSubtitleSidecar matches subtitles named after the video', () => {
  assert.ok(isSubtitleSidecar('/m/Movie.2020.mkv', '/m/movie.2020.en.SRT'))
  assert.ok(!isSubtitleSidecar('/m/Movie.2020.mkv', '/m/Other.srt'))
  assert.ok(!isSubtitleSidecar('/m/Movie.2020.mkv', '/m/Movie.2020.mkv'))
})
