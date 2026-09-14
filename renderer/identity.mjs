// Who you are to your friends. A username is a handle you pick plus a tag, like moviefan#k7qm-x3pa.
// Each install keeps an ECDSA key pair and the tag is a hash of the handle and the public key, so
// nobody can take your username without your key. Picking a new username makes a new key pair,
// and friends have to add you again.

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32: no i, l, o or u
const TAG_LENGTH = 8
const KEY_ALGORITHM = {name: 'ECDSA', namedCurve: 'P-256'}
const SIGNATURE = {name: 'ECDSA', hash: 'SHA-256'}
const encode = (text) => new TextEncoder().encode(text)

export const HANDLE_HINT = '3 to 20 letters, numbers, _ or .'

export function normalizeHandle(input) {
  const handle = String(input ?? '')
    .trim()
    .toLowerCase()
  return /^[a-z0-9_.]{3,20}$/.test(handle) ? handle : null
}

async function tagFor(publicKey, handle) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encode(`${handle}:${publicKey.crv}:${publicKey.x}:${publicKey.y}`)))
  let tag = ''
  let buffer = 0
  let bits = 0
  for (const byte of digest) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5 && tag.length < TAG_LENGTH) {
      bits -= 5
      tag += ALPHABET[(buffer >> bits) & 31]
    }
    buffer &= (1 << bits) - 1
    if (tag.length === TAG_LENGTH) break
  }
  return `${tag.slice(0, 4)}-${tag.slice(4)}`
}

export const usernameFor = async (publicKey, handle) => `${handle}#${await tagFor(publicKey, handle)}`

// A username however it was typed or pasted, or null if it can't be one.
export function normalizeUsername(input) {
  const parts = String(input ?? '').split('#')
  if (parts.length !== 2) return null
  const handle = normalizeHandle(parts[0])
  const tag = parts[1]
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '')
    .replace(/[il]/g, '1')
    .replace(/o/g, '0')
  if (!handle || tag.length !== TAG_LENGTH || ![...tag].every((c) => ALPHABET.includes(c))) return null
  return `${handle}#${tag.slice(0, 4)}-${tag.slice(4)}`
}

export async function createKeys() {
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify'])
  const [publicJwk, privateKey] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ])
  return {publicKey: {kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y}, privateKey}
}

// `keys` lets the welcome screen preview the tag before the identity is saved.
export async function createIdentity(handle, keys = null) {
  const {publicKey, privateKey} = keys || (await createKeys())
  return {handle, username: await usernameFor(publicKey, handle), publicKey, privateKey}
}

// A stored identity is only used if its username still matches its handle and key.
export async function isValidIdentity(identity) {
  try {
    const handle = normalizeHandle(identity?.handle)
    return Boolean(handle && identity.privateKey?.d) && (await usernameFor(identity.publicKey, handle)) === identity.username
  } catch {
    return false
  }
}

export async function sign(identity, text) {
  const key = await crypto.subtle.importKey('jwk', identity.privateKey, KEY_ALGORITHM, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign(SIGNATURE, key, encode(text)))
  return btoa(String.fromCharCode(...signature))
}

// True only when `publicKey` matches `username` and its private key signed `text`.
export async function verifySigned({username, publicKey, signature} = {}, text) {
  try {
    if (normalizeUsername(username) !== username) return false
    if ((await usernameFor(publicKey, username.split('#')[0])) !== username) return false
    const jwk = {kty: 'EC', crv: publicKey.crv, x: publicKey.x, y: publicKey.y}
    const key = await crypto.subtle.importKey('jwk', jwk, KEY_ALGORITHM, false, ['verify'])
    const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))
    return await crypto.subtle.verify(SIGNATURE, key, bytes, encode(text))
  } catch {
    return false
  }
}
