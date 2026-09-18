import {cleanRoomDetails} from './room-name.mjs'
import {createPlaylist, mergePlaylist, playlistSnapshot} from './playlist.mjs'
import {isRevision, finite} from './protocol.mjs'

const validCode = (code) => typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code)

// A personal bookmark is never merged into the host-authoritative shared progress.
export function cleanObserved(value, playlist) {
  if (!value || !playlist.items.has(value.id) || !finite(value.time, 0, 1e9) || !finite(value.duration, 0, 1e9)) return null
  return {id: value.id, time: Math.min(value.time, value.duration || value.time), duration: value.duration}
}

// Each identity keeps a copy of each room. Only this local record contains file
// paths; playlist snapshots exchanged with peers never contain file capabilities.
export class RoomHistory {
  constructor(storage, username) {
    this.storage = storage
    this.username = username
    this.prefix = `rooms:v1:${username}:`
  }

  read(key) {
    try { return JSON.parse(this.storage.getItem(key)) } catch { return null }
  }

  codes() {
    const codes = this.read(`${this.prefix}index`)
    return Array.isArray(codes) ? [...new Set(codes.filter(validCode))] : []
  }

  load(code) {
    if (!validCode(code)) return null
    const saved = this.read(this.prefix + code)
    if (saved?.version !== 1) return null
    const playlist = createPlaylist()
    mergePlaylist(playlist, saved.playlist)
    const ownFiles = new Map()
    for (const entry of Array.isArray(saved.ownFiles) ? saved.ownFiles.slice(0, 500) : []) {
      if (!Array.isArray(entry)) continue
      const [id, path] = entry
      if (playlist.items.get(id)?.owner === this.username && typeof path === 'string' && path.length > 0 && path.length <= 32768) ownFiles.set(id, path)
    }
    return {code, details: cleanRoomDetails(saved.details), playlist, ownFiles, observed: cleanObserved(saved.observed, playlist),
      claimedAt: isRevision(saved.claimedAt) ? saved.claimedAt : 0,
      savedAt: Number.isFinite(saved.savedAt) ? saved.savedAt : 0}
  }

  list() {
    return this.codes().map((code) => this.load(code)).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt)
  }

  save({code, details, playlist, ownFiles, claimedAt, observed}) {
    if (!validCode(code)) throw new Error('Invalid room code')
    const saved = {version: 1, details, playlist: playlistSnapshot(playlist), claimedAt, observed: cleanObserved(observed, playlist), savedAt: Date.now(),
      ownFiles: [...ownFiles].filter(([id]) => playlist.items.get(id)?.owner === this.username)}
    this.storage.setItem(this.prefix + code, JSON.stringify(saved))
    const codes = this.codes()
    if (!codes.includes(code)) this.storage.setItem(`${this.prefix}index`, JSON.stringify([...codes, code]))
  }

  remove(code) {
    if (!validCode(code)) throw new Error('Invalid room code')
    this.storage.setItem(`${this.prefix}index`, JSON.stringify(this.codes().filter((saved) => saved !== code)))
    this.storage.removeItem(this.prefix + code)
  }
}
