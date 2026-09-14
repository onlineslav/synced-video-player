// Optional credential broker. Deploy separately; its secrets never enter Electron.
export default {
  async fetch(request, env) {
    const reply = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}})
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/credentials') return reply({error: 'Not found'}, 404)
    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN || !env.RATE_LIMITER) return reply({error: 'Relay is not configured'}, 503)
    const ip = request.headers.get('CF-Connecting-IP')
    if (!ip) return reply({error: 'Missing client address'}, 400)
    if (!(await env.RATE_LIMITER.limit({key: ip})).success) return reply({error: 'Try again later'}, 429)
    const ttl = 3600
    try {
      const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST', signal: AbortSignal.timeout(3000),
        headers: {Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({ttl}),
      })
      if (!response.ok) return reply({error: 'Relay temporarily unavailable'}, 503)
      const {iceServers} = await response.json()
      return reply({iceServers: [].concat(iceServers || []), expiresAt: Date.now() + ttl * 1000})
    } catch { return reply({error: 'Relay temporarily unavailable'}, 503) }
  },
}
