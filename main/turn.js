// Optional TURN relay for networks where a direct WebRTC connection can't be punched through.
// Reads config/turn.json (see config/turn.example.json); without it the app uses STUN only.
const fs = require('node:fs/promises')

async function loadIceServers(configPath) {
  let config
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  } catch {
    return []
  }

  if (Array.isArray(config.iceServers)) return config.iceServers

  const {keyId, apiToken} = config.cloudflare || {}
  if (keyId && apiToken) {
    try {
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({ttl: 86400}),
      })
      if (res.ok) {
        const {iceServers} = await res.json()
        return [].concat(iceServers || [])
      }
      console.warn(`TURN credentials request failed: ${res.status}`)
    } catch (err) {
      console.warn(`TURN credentials request failed: ${err.message}`)
    }
  }
  return []
}

module.exports = {loadIceServers}
