// Reactions everyone in the room sees and hears. The sounds are synthesized with Web Audio, so
// there are no audio files to ship.

export const REACTIONS = {
  airhorn: {emoji: '📯', label: 'Air horn', key: 'Digit1'},
  clap: {emoji: '👏', label: 'Golf clap', key: 'Digit2'},
  quack: {emoji: '🦆', label: 'Quack', key: 'Digit3'},
  confetti: {emoji: '🎉', label: 'Confetti', key: 'Digit4'},
}

export const REACTION_COOLDOWN_MS = 800

// One reaction per person per cooldown, so nobody can drown out the film.
export function createRateLimiter(cooldownMs = REACTION_COOLDOWN_MS) {
  const last = new Map()
  return (who, now) => {
    if (now - (last.get(who) ?? -Infinity) < cooldownMs) return false
    last.set(who, now)
    return true
  }
}

// Silence to `peak` and back, returning when it ends.
function envelope(param, start, peak, attack, hold, release) {
  param.setValueAtTime(0.0001, start)
  param.exponentialRampToValueAtTime(peak, start + attack)
  param.setValueAtTime(peak, start + attack + hold)
  param.exponentialRampToValueAtTime(0.0001, start + attack + hold + release)
  return start + attack + hold + release
}

function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  return buffer
}

function filter(ctx, type, frequency, q = 1) {
  const node = ctx.createBiquadFilter()
  node.type = type
  node.frequency.value = frequency
  node.Q.value = q
  return node
}

// Two short blasts and a long one of a detuned, slightly sagging brass chord.
function airhorn(ctx, out, t) {
  const tone = filter(ctx, 'lowpass', 2400)
  tone.connect(out)
  for (const [offset, length] of [[0, 0.12], [0.2, 0.12], [0.4, 0.8]]) {
    const gain = ctx.createGain()
    gain.connect(tone)
    const start = t + offset
    const end = envelope(gain.gain, start, 0.2, 0.015, length, 0.08)
    for (const frequency of [415, 523, 622]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(frequency, start)
      osc.frequency.linearRampToValueAtTime(frequency * 0.97, end)
      osc.detune.value = (Math.random() - 0.5) * 16
      osc.connect(gain)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  }
}

// Five slow, polite claps.
function golfClap(ctx, out, t) {
  const noise = noiseBuffer(ctx, 0.2)
  for (let i = 0; i < 5; i++) {
    const start = t + i * 0.5 + Math.random() * 0.06
    const source = ctx.createBufferSource()
    source.buffer = noise
    const gain = ctx.createGain()
    envelope(gain.gain, start, 0.55, 0.002, 0.01, 0.09)
    source.connect(filter(ctx, 'bandpass', 1200 + Math.random() * 400, 1.1)).connect(gain).connect(out)
    source.start(start)
    source.stop(start + 0.2)
  }
}

// A nasal sawtooth falling in pitch, through a duck-ish formant. Twice.
function quack(ctx, out, t) {
  for (const offset of [0, 0.28]) {
    const start = t + offset
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(560, start)
    osc.frequency.exponentialRampToValueAtTime(330, start + 0.17)
    const nasal = filter(ctx, 'peaking', 2600)
    nasal.gain.value = 8
    const gain = ctx.createGain()
    const end = envelope(gain.gain, start, 0.6, 0.012, 0.09, 0.07)
    osc.connect(filter(ctx, 'bandpass', 1050, 2.5)).connect(nasal).connect(gain).connect(out)
    osc.start(start)
    osc.stop(end + 0.02)
  }
}

// A soft party-popper pop.
function pop(ctx, out, t) {
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx, 0.3)
  const gain = ctx.createGain()
  envelope(gain.gain, t, 0.35, 0.003, 0.02, 0.22)
  source.connect(filter(ctx, 'highpass', 900)).connect(gain).connect(out)
  source.start(t)
  source.stop(t + 0.3)
}

const SOUNDS = {airhorn, clap: golfClap, quack, confetti: pop}

export function playReactionSound(ctx, out, kind) {
  SOUNDS[kind]?.(ctx, out, ctx.currentTime + 0.01)
}
