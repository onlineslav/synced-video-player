import {finite, HOST_TIMEOUT_MS} from './protocol.mjs'

// Offset between monotonic clocks, measured with a request/response midpoint.
// Prefer short round trips; delayed control messages must not move the media clock backward.
export function updateClock(previous, sent, received, remoteNow) {
  const rtt = received - sent
  if (!finite(rtt, 0, 5000) || !finite(remoteNow, 0, 1e15)) return previous
  const sample = {offset: remoteNow - (sent + received) / 2, rtt, at: received}
  if (!previous || received - previous.at > 60_000 || rtt <= previous.rtt * 1.2) return sample
  return previous
}

export function estimatedMediaTime(state, now, clock) {
  if (!state) return 0
  if (state.ended) return state.time
  const age = Math.max(0, Math.min(HOST_TIMEOUT_MS, now - state.receivedAt))
  const transit = clock && now - clock.at < 60_000 ? Math.max(0, Math.min(5000, state.receivedAt + clock.offset - state.sentAt)) : 0
  const elapsed = state.playing && !state.buffering && !state.loading ? (age + transit) / 1000 : 0
  return Math.max(0, Math.min(state.time + elapsed, state.duration || Infinity))
}

// WebRTC still handles congestion control. These ceilings keep repeated freezes from
// being treated only by increasing latency, and protect a host with several viewers.
export function chooseSendQuality(previous, {receiver, capacity, peerCount = 1, width = 1920, height = 1080}, intervalMs = 2000) {
  const ceiling = Math.min(10_000_000, 18_000_000 / Math.max(1, peerCount))
  const troubled = receiver && (receiver.lossPct > 2 || receiver.freezes > 0)
  let bitrate = Math.min(previous?.bitrate ?? Math.min(4_000_000, ceiling), ceiling)
  let calmMs = troubled ? 0 : (previous?.calmMs || 0) + intervalMs
  if (troubled) bitrate *= 0.75
  else if (calmMs >= 12_000) { bitrate *= 1.15; calmMs = 0 }
  if (finite(capacity, 100_000, 1e10)) bitrate = Math.min(bitrate, capacity * 0.8)
  bitrate = Math.round(Math.max(300_000, Math.min(ceiling, bitrate)))
  const maxHeight = bitrate < 900_000 ? 360 : bitrate < 2_000_000 ? 540 : bitrate < 3_500_000 ? 720 : 1080
  return {bitrate, calmMs, scale: Math.max(1, width / 1920, height / maxHeight)}
}

// Always aggregate complete per-peer records, never one peer's sender and another's receiver.
export function aggregateLinks(links) {
  if (!links.length) return null
  const score = (p) => (p.receiver?.freezes || 0) * 100 + (p.receiver?.lossPct || 0) * 10 + (p.sender?.limit === 'none' ? 0 : 20) + (p.rttMs || 0) / 100
  return links.reduce((worst, next) => score(next) > score(worst) ? next : worst)
}
