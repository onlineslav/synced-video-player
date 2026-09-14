// Who you are to your friends. Each install keeps an ECDSA key pair, and the username is a hash
// of the public key, so a username can't be claimed without the key behind it. A new key pair
// means a new username, and friends have to add you again.

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32: no i, l, o or u
const USERNAME_LENGTH = 12
const KEY_ALGORITHM = {name: 'ECDSA', namedCurve: 'P-256'}

export const formatUsername = (raw) => raw.match(/.{1,4}/g).join('-')

export async function usernameFor(publicKey) {
  const text = `${publicKey.crv}:${publicKey.x}:${publicKey.y}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let raw = ''
  let buffer = 0
  let bits = 0
  for (const byte of digest) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5 && raw.length < USERNAME_LENGTH) {
      bits -= 5
      raw += ALPHABET[(buffer >> bits) & 31]
    }
    buffer &= (1 << bits) - 1
    if (raw.length === USERNAME_LENGTH) break
  }
  return formatUsername(raw)
}

// A username however it was typed or pasted, or null if it can't be one.
export function normalizeUsername(input) {
  const raw = String(input ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '')
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
  return raw.length === USERNAME_LENGTH && [...raw].every((c) => ALPHABET.includes(c)) ? formatUsername(raw) : null
}

export async function createIdentity() {
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify'])
  const [publicJwk, privateKey] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ])
  const publicKey = {kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y}
  return {username: await usernameFor(publicKey), publicKey, privateKey}
}

// A stored identity is only used if its username still matches its key.
export async function isValidIdentity(identity) {
  try {
    return Boolean(identity?.privateKey?.d) && (await usernameFor(identity.publicKey)) === identity.username
  } catch {
    return false
  }
}
