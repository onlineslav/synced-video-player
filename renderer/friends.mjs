// Friends without a server. Every app waits in its own inbox room. Adding someone joins a room
// for just the two of you, plus their inbox until they confirm they got the request. Nothing a
// peer says is believed until it proves its username with a signed hello, so usernames can't be
// impersonated. `joinRoom` is Trystero's, injected so the protocol can be tested in memory.
import {normalizeUsername, sign, verifySigned} from './identity.mjs'
import {cleanDisplayName} from './profile.mjs'

export const inboxRoomId = (username) => `inbox:${username}`
export const pairRoomId = (a, b) => `pair:${[a, b].sort().join(':')}`
// Binding the room and both peer ids stops a hello being replayed anywhere else.
export const helloText = (roomId, fromPeer, toPeer) => `synced-video-player hello ${roomId} ${fromPeer} ${toPeer}`

const MAX_EARLY_MESSAGES = 10

export class FriendNetwork extends EventTarget {
  // storage: {load(key) -> value | null, save(key, value)}
  constructor({joinRoom, selfId, appId, storage, turnConfig = []}) {
    super()
    Object.assign(this, {joinRoom, selfId, appId, storage, turnConfig})
    this.identity = null
    this.profile = {}
    this.friends = new Map((storage.load('friends') || []).map((f) => [f.username, f]))
    this.requests = new Map((storage.load('friendRequests') || []).map((r) => [r.username, r]))
    this.links = new Map() // roomId -> link
    this.online = new Map() // username -> {link, peerId}
  }

  start(identity, profile) {
    this.identity = identity
    this.profile = profile
    this.syncRooms()
  }

  // A new username: everyone has to be asked again.
  restart(identity) {
    for (const roomId of [...this.links.keys()]) this.leave(roomId)
    for (const friend of this.friends.values()) Object.assign(friend, {confirmed: false, requested: false})
    this.save()
    this.start(identity, this.profile)
    this.changed()
  }

  stop() {
    for (const roomId of [...this.links.keys()]) this.leave(roomId)
  }

  list() {
    return [...this.friends.values()].map((friend) => ({...friend, online: this.online.has(friend.username)}))
  }

  requestList() {
    return [...this.requests.values()]
  }

  // Returns an error message, or null when added.
  add(input) {
    const username = normalizeUsername(input)
    if (!username) return "That isn't a username. They look like k7qm-x3pa-trb2."
    if (username === this.identity?.username) return "That's your own username."
    if (this.friends.has(username)) return 'Already in your friends.'
    const name = this.requests.get(username)?.name ?? null
    this.friends.set(username, {username, name, confirmed: false, requested: false})
    this.requests.delete(username)
    this.save()
    this.syncRooms()
    this.changed()
    return null
  }

  remove(username) {
    this.friends.delete(username)
    this.online.delete(username)
    this.save()
    this.syncRooms()
    this.changed()
  }

  ignoreRequest(username) {
    this.requests.delete(username)
    this.save()
    this.changed()
  }

  updateProfile(profile) {
    this.profile = profile
    for (const {link, peerId} of this.online.values()) link.actions.profile.send(profile, {target: peerId}).catch(() => {})
  }

  // ---------- Rooms ----------

  syncRooms() {
    const me = this.identity?.username
    if (!me) return
    const wanted = new Map([[inboxRoomId(me), {kind: 'inbox'}]])
    for (const friend of this.friends.values()) {
      wanted.set(pairRoomId(me, friend.username), {kind: 'pair', username: friend.username})
      if (!friend.confirmed && !friend.requested) wanted.set(inboxRoomId(friend.username), {kind: 'request', username: friend.username})
    }
    for (const roomId of [...this.links.keys()]) if (!wanted.has(roomId)) this.leave(roomId)
    for (const [roomId, purpose] of wanted) if (!this.links.has(roomId)) this.join(roomId, purpose)
  }

  join(roomId, purpose) {
    const config = {appId: this.appId, password: roomId, ...(this.turnConfig.length && {turnConfig: this.turnConfig})}
    const room = this.joinRoom(config, roomId)
    const link = {roomId, ...purpose, room, peers: new Map(), early: new Map(), actions: {}}
    for (const name of ['hello', 'profile', 'request', 'ack']) link.actions[name] = room.makeAction(name)
    this.links.set(roomId, link)

    room.onPeerJoin = (peerId) => this.sendHello(link, peerId)
    room.onPeerLeave = (peerId) => {
      const username = link.peers.get(peerId)
      link.peers.delete(peerId)
      link.early.delete(peerId)
      // A peer has the same id in every room; only leaving the room you're friends through counts.
      const entry = this.online.get(username)
      if (entry?.link === link && entry.peerId === peerId) {
        this.online.delete(username)
        this.changed()
      }
    }
    link.actions.hello.onMessage = async (hello, {peerId}) => {
      const genuine = await verifySigned(hello, helloText(roomId, peerId, this.selfId))
      if (!genuine || this.links.get(roomId) !== link || link.peers.has(peerId)) return
      link.peers.set(peerId, hello.username)
      this.verified(link, peerId, hello.username)
      for (const replay of link.early.get(peerId) || []) replay()
      link.early.delete(peerId)
    }
    // Anything else waits until its sender's hello has been checked.
    const onVerified = (handler) => (data, {peerId}) => {
      if (link.peers.has(peerId)) return handler(data, link.peers.get(peerId), peerId)
      const queue = link.early.get(peerId) || []
      if (queue.length < MAX_EARLY_MESSAGES) queue.push(() => handler(data, link.peers.get(peerId), peerId))
      link.early.set(peerId, queue)
    }
    link.actions.profile.onMessage = onVerified((profile, username) => {
      const friend = this.friends.get(username)
      if (link.kind !== 'pair' || username !== link.username || !friend) return
      friend.name = cleanDisplayName(profile?.name) ?? friend.name
      this.save()
      this.changed()
    })
    link.actions.request.onMessage = onVerified((request, username, peerId) => {
      if (link.kind !== 'inbox') return
      if (!this.friends.has(username)) {
        this.requests.set(username, {username, name: cleanDisplayName(request?.name)})
        this.save()
        this.changed()
      }
      link.actions.ack.send({}, {target: peerId}).catch(() => {})
    })
    link.actions.ack.onMessage = onVerified((_ack, username) => {
      const friend = this.friends.get(username)
      if (link.kind !== 'request' || username !== link.username || !friend) return
      friend.requested = true
      this.save()
      this.syncRooms()
      this.changed()
    })
  }

  leave(roomId) {
    const link = this.links.get(roomId)
    if (!link) return
    this.links.delete(roomId)
    for (const [username, entry] of this.online) if (entry.link === link) this.online.delete(username)
    link.room.leave()
  }

  async sendHello(link, peerId) {
    const {username, publicKey} = this.identity
    const signature = await sign(this.identity, helloText(link.roomId, this.selfId, peerId))
    if (this.links.get(link.roomId) === link) link.actions.hello.send({username, publicKey, signature}, {target: peerId}).catch(() => {})
  }

  verified(link, peerId, username) {
    if (username !== link.username) return // strangers in a pair room or someone else's inbox
    if (link.kind === 'request') {
      link.actions.request.send({name: this.profile.name}, {target: peerId}).catch(() => {})
    } else if (link.kind === 'pair') {
      const friend = this.friends.get(username)
      if (!friend) return
      this.online.set(username, {link, peerId})
      if (!friend.confirmed) {
        friend.confirmed = true
        this.save()
        this.syncRooms() // no need to keep asking
      }
      this.requests.delete(username)
      link.actions.profile.send(this.profile, {target: peerId}).catch(() => {})
      this.changed()
    }
  }

  save() {
    this.storage.save('friends', [...this.friends.values()])
    this.storage.save('friendRequests', [...this.requests.values()])
  }

  changed() {
    this.dispatchEvent(new Event('change'))
  }
}
