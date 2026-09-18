import test from 'node:test'
import assert from 'node:assert/strict'
import {parseYouTubeUrl} from '../shared/youtube.mjs'
import {createPlaylist, addItem, orderedItems, mergePlaylist, playlistSnapshot} from '../renderer/playlist.mjs'
import {RoomHistory} from '../renderer/room-history.mjs'

const video = 'M7lc1UVf-VE'
const list = 'PLBCF2DAC6FFB574DE'

test('YouTube URLs accept supported hosts and video forms, preferring full playlists', () => {
  for (const url of [`https://youtu.be/${video}?si=share`, `https://www.youtube.com/watch?v=${video}`,
    `https://m.youtube.com/shorts/${video}`, `https://youtube.com/live/${video}`, `https://youtube.com/embed/${video}`]) {
    assert.deepEqual(parseYouTubeUrl(url), {videoId: video, playlistId: null})
  }
  assert.deepEqual(parseYouTubeUrl(`https://youtube.com/watch?v=${video}&list=${list}&index=4`), {videoId: video, playlistId: list})
  assert.deepEqual(parseYouTubeUrl(`https://youtube.com/playlist?list=${list}`), {videoId: null, playlistId: list})
})

test('YouTube URLs reject arbitrary sources, credentials, malformed identifiers and schemes', () => {
  for (const url of ['not a URL', `https://youtube.com.evil.com/watch?v=${video}`, `file:///watch?v=${video}`,
    `https://youtube.com@evil.com/watch?v=${video}`, `https://user@youtube.com/watch?v=${video}`,
    `https://youtube.com:9000/watch?v=${video}`, 'https://youtube.com/watch?v=bad', 'https://youtube.com/playlist?list=<script>']) {
    assert.throws(() => parseYouTubeUrl(url))
  }
})

test('YouTube playlist order and duplicate videos survive room synchronization and local saves', () => {
  const playlist = createPlaylist()
  const videos = [video, 'dQw4w9WgXcQ', video]
  videos.forEach((youtubeId, index) => addItem(playlist, {id: `item:${index}`, title: `Video ${index}`, position: index, youtubeId}, 'owner'))
  const copy = createPlaylist()
  mergePlaylist(copy, playlistSnapshot(playlist), {selfId: 'owner', ownFiles: new Map()})
  assert.deepEqual(orderedItems(copy).map((item) => item.youtubeId), videos)
  const data = new Map()
  const history = new RoomHistory({getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value)}, 'owner')
  history.save({code: 'ABCDEFGH', playlist: copy, ownFiles: new Map(), claimedAt: 1})
  assert.deepEqual(orderedItems(history.load('ABCDEFGH').playlist).map((item) => item.youtubeId), videos)
  assert.equal(addItem(copy, {id: 'bad', title: 'Invalid', position: 5, youtubeId: 'https://evil.com'}, 'peer'), null)
})
