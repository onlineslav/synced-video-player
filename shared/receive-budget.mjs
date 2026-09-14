// Bounds apply before allocating/reassembling payloads. Also frees abandoned chunks.
export const WIRE_LIMITS = {image: 50 * 1024 * 1024, board: 16 * 1024 * 1024, playlist: 2 * 1024 * 1024, '@_response': 4 * 1024 * 1024}
export function createReceiveBudget(expire, {now = Date.now, idleMs = 30_000, perPeer = 64 * 1024 * 1024, total = 128 * 1024 * 1024} = {}) {
  const entries = new Map()
  let timer = null
  const remove = (key, expired) => {
    const entry = entries.get(key)
    entries.delete(key)
    if (expired && entry) expire(entry.peer, entry.type, entry.nonce)
    if (!entries.size) { clearInterval(timer); timer = null }
  }
  const sweep = () => { for (const [key, entry] of entries) if (now() - entry.at >= idleMs) remove(key, true) }
  return {
    accept(peer, type, nonce, bytes, last) {
      sweep()
      const key = JSON.stringify([peer, type, nonce])
      let entry = entries.get(key)
      const list = [...entries.values()]
      // Tiny/empty chunks still allocate array entries in the wire decoder.
      // A normal 50 MiB image takes ~3,300 chunks; reject pathological streams.
      if ((entry?.chunks || 0) >= 8192) return false
      if (!entry && list.filter((e) => e.peer === peer).length >= 8) return false
      const limit = WIRE_LIMITS[type] || (type === 'state' ? 256 * 1024 : 64 * 1024)
      if ((entry?.bytes || 0) + bytes > limit || list.filter((e) => e.peer === peer).reduce((n, e) => n + e.bytes, 0) + bytes > perPeer || list.reduce((n, e) => n + e.bytes, 0) + bytes > total) return false
      if (!entry) entries.set(key, entry = {peer, type, nonce, at: now(), bytes: 0, chunks: 0})
      entry.at = now()
      entry.bytes += bytes
      entry.chunks++
      if (last) remove(key, false)
      else if (!timer) { timer = setInterval(sweep, Math.min(idleMs, 5000)); timer.unref?.() }
      return true
    },
    clearPeer(peer) { for (const [key, entry] of entries) if (entry.peer === peer) remove(key, true) },
    sweep,
  }
}
