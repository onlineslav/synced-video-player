// Confetti across the whole window. Particles are plain data so the physics can be tested.

const COLORS = ['#ff4d4d', '#ffb84d', '#ffe14d', '#3ddc84', '#4da3ff', '#c77dff', '#ff7ac6']
const GRAVITY = 380 // px/s²
const MAX_FALL_SPEED = 520 // px/s
const AIR_DRAG = 0.4 // share of sideways speed kept per second

// Starts above the window so pieces rain in from the top.
export function launchConfetti(width, height, count = 160, random = Math.random) {
  return Array.from({length: count}, () => ({
    x: random() * width,
    y: -20 - random() * height * 0.6,
    vx: (random() - 0.5) * 260,
    vy: 80 + random() * 220,
    size: 6 + random() * 7,
    angle: random() * Math.PI * 2,
    spin: (random() - 0.5) * 14,
    color: COLORS[Math.floor(random() * COLORS.length)],
  }))
}

// Moves every piece `dt` seconds on and drops the ones that fell out of view.
export function stepConfetti(particles, dt, height) {
  const drag = Math.pow(AIR_DRAG, dt)
  return particles.filter((p) => {
    p.vx *= drag
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL_SPEED)
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.angle += p.spin * dt
    return p.y < height + 30
  })
}

export function drawConfetti(ctx, particles) {
  for (const p of particles) {
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    // Squashing by the spin makes each piece look like it flutters.
    ctx.scale(1, Math.cos(p.angle * 2))
    ctx.fillStyle = p.color
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
    ctx.restore()
  }
}
