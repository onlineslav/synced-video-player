export const JOIN_WAIT_MS = 30_000

// A room exists locally before any remote peer has connected. Entering its code
// must not be presented as a successful join or as creating a new room.
export function roomConnection({joining, persistent, connectedBefore, waitingSince, error, hasTurn}, peerCount, now) {
  if (peerCount) return {text: 'Friend connected', detail: '', problem: false}
  if (persistent && !error) return {text: "You're the only one here", detail: 'Your playlist and progress are saved. Invite someone or play available media.', problem: false}
  const delayed = (joining || connectedBefore) && now - waitingSince >= JOIN_WAIT_MS
  if (error || delayed) {
    const foundPeer = error?.includes('after exchanging SDP')
    const detail = foundPeer
      ? `Your friend was found, but the connection could not be established. ${hasTurn
        ? 'The configured connection relay may be unavailable. Try another network.'
        : 'Try another network or configure a TURN relay for networks that block direct connections.'} Still trying to connect…`
      : 'No connection yet. Check that your friend has the room open, that the codes match, and that both apps are up to date. Still trying to connect…'
    return {text: 'Unable to connect yet', detail, problem: true}
  }
  if (connectedBefore) return {text: 'Friend disconnected · reconnecting…', detail: 'Waiting for your friend to reconnect…', problem: false}
  if (joining) return {text: 'Connecting to your friend…', detail: 'Joining your friend’s room. Waiting for a connection…', problem: false}
  return {text: 'Waiting for your friend to join…', detail: '', problem: false}
}
