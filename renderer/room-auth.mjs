import {sign, verifySigned} from './identity.mjs'
import {isId} from './protocol.mjs'

export async function authenticateRoomPeer(identity, selfId, code, peerId, send, receive) {
  const nonce = crypto.randomUUID()
  await send({nonce})
  const challenge = (await receive()).data
  if (!isId(challenge?.nonce)) throw new Error('Invalid room handshake')
  const text = (from, to, challenge) => `watch-room-v2 ${code} ${from} ${to} ${challenge}`
  await send({username: identity.username, publicKey: identity.publicKey,
    signature: await sign(identity, text(selfId, peerId, challenge.nonce))})
  const hello = (await receive()).data
  if (!await verifySigned(hello, text(peerId, selfId, nonce))) throw new Error('Could not verify room identity')
  return hello.username
}
