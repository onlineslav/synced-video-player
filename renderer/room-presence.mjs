import {authenticateRoomPeer} from './room-auth.mjs'
import {cleanDisplayName} from './profile.mjs'
import {isRevision, messageLimiter} from './protocol.mjs'

const HEARTBEAT_MS = 10000
export const PRESENCE_TIMEOUT_MS = 30000
const validCode = (code) => typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code)

// A separate channel lets Home observe saved rooms without joining their media
// sessions. Only authenticated peers actively in that room count as occupants.
export class RoomPresence extends EventTarget {
  constructor({joinRoom, selfId, appId, authenticate = authenticateRoomPeer, now = () => performance.now()}) {
    super()
    Object.assign(this, {joinRoom, selfId, appId, authenticate, now})
    this.links = new Map()
    this.closing = new Map()
    this.identity = null
    this.code = null
    this.name = null
  }

  start(identity) {
    this.stop()
    this.identity = identity
    this.timer = setInterval(() => {
      for (const link of this.links.values()) {
        this.send(link)
        for (const [id, peer] of link.members) if (this.now() - peer.seen > PRESENCE_TIMEOUT_MS) link.members.delete(id)
      }
      this.changed()
    }, HEARTBEAT_MS)
    this.timer.unref?.()
  }

  update(codes, activeCode, name) {
    if (!this.identity) return
    const changed = this.code !== activeCode || this.name !== name
    this.code = activeCode
    this.name = name
    const wanted = new Set(codes.filter(validCode))
    if (validCode(activeCode)) wanted.add(activeCode)
    for (const [code, link] of this.links) if (!wanted.has(code)) this.close(code, link)
    for (const code of wanted) if (!this.links.has(code)) {
      const link = {code, room: null, identities: new Map(), members: new Map(), sequence: 0, error: false}
      this.links.set(code, link)
      this.open(link, this.identity)
    }
    if (changed) for (const link of this.links.values()) this.send(link)
  }

  async open(link, identity) {
    await this.closing.get(link.code)
    const active = () => this.identity === identity && this.links.get(link.code) === link
    if (!active()) return
    const verifying = new Set()
    try {
      // Isolate presence by room ID, not appId: Trystero shares connections only
      // within an appId, including when the public discovery relays are down.
      const room = this.joinRoom({appId: this.appId, password: link.code}, `presence:${link.code}`, {
        onPeerHandshake: async (peerId, send, receive) => {
          if (!active() || verifying.size + link.identities.size >= 64) throw new Error('Presence channel is full')
          verifying.add(peerId)
          try {
            const username = await this.authenticate(identity, this.selfId, `${link.code}:presence`, peerId, send, receive)
            if (!active()) throw new Error('Presence channel closed')
            link.identities.set(peerId, username)
          } finally { verifying.delete(peerId) }
        },
        onJoinError: ({peerId}) => {
          if (!active()) return
          link.identities.delete(peerId)
          link.members.delete(peerId)
          link.error = true
          this.changed()
        },
      })
      link.room = room
      link.action = room.makeAction('presence')
      const allow = messageLimiter(10)
      link.action.onMessage = (message, {peerId}) => {
        if (!active() || !link.identities.has(peerId) || !allow(peerId) || !isRevision(message?.sequence) ||
            typeof message.inRoom !== 'boolean' || typeof message.name !== 'string') return
        const previous = link.members.get(peerId)
        if (previous && message.sequence <= previous.sequence) return
        link.members.set(peerId, {username: link.identities.get(peerId), name: cleanDisplayName(message.name),
          active: message.inRoom, sequence: message.sequence, seen: this.now()})
        link.error = false
        this.changed()
      }
      room.onPeerJoin = (peerId) => { if (active()) this.send(link, peerId) }
      room.onPeerLeave = (peerId) => {
        if (!active()) return
        link.identities.delete(peerId)
        link.members.delete(peerId)
        this.changed()
      }
      this.send(link)
    } catch {
      if (active()) { link.error = true; this.changed() }
    }
  }

  send(link, target) {
    link.action?.send({inRoom: this.code === link.code, name: this.name || '', sequence: ++link.sequence},
      target ? {target} : {}).catch(() => {})
  }

  list(code) {
    const link = this.links.get(code)
    const members = new Map()
    for (const member of link?.members.values() || []) {
      if (member.active && this.now() - member.seen <= PRESENCE_TIMEOUT_MS) members.set(member.username, member)
    }
    return {members: [...members.values()].sort((a, b) => (a.name || a.username).localeCompare(b.name || b.username)), error: Boolean(link?.error)}
  }

  close(code, link) {
    this.links.delete(code)
    if (!link.room) return
    const pending = Promise.resolve().then(() => link.room.leave()).catch(() => {}).finally(() => {
      if (this.closing.get(code) === pending) this.closing.delete(code)
    })
    this.closing.set(code, pending)
  }

  stop() {
    clearInterval(this.timer)
    this.identity = null
    for (const [code, link] of this.links) this.close(code, link)
    this.code = null
    return Promise.allSettled(this.closing.values())
  }

  changed() { this.dispatchEvent(new Event('change')) }
}
