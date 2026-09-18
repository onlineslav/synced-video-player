// Only YouTube identifiers cross the room boundary; never arbitrary embed URLs.
export const isYouTubeId = (value) => typeof value === 'string' && /^[\w-]{11}$/.test(value)
export const isYouTubePlaylist = (value) => typeof value === 'string' && /^[\w-]{10,100}$/.test(value)

export function parseYouTubeUrl(value) {
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a valid YouTube video or playlist URL.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
    throw new Error('Only YouTube video and playlist URLs are supported for now.')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const videoId = url.hostname === 'youtu.be' ? parts[0]
    : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : url.searchParams.get('v')
  const playlistId = url.searchParams.get('list')
  if (playlistId && !isYouTubePlaylist(playlistId)) throw new Error('This YouTube playlist URL is invalid.')
  if (!playlistId && !isYouTubeId(videoId)) throw new Error('Enter a YouTube video or playlist URL.')
  return {videoId: isYouTubeId(videoId) ? videoId : null, playlistId: playlistId || null}
}
