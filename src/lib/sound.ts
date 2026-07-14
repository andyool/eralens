// Minimal, non-intrusive interaction sounds. Off by default; the caller gates
// every call on the user's sound toggle. Uses a single lazily-created
// AudioContext and short, soft sine blips — never anything sustained.

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function blip(freq: number, duration = 0.09, gain = 0.05) {
  const ac = context()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.value = 0
  osc.connect(g)
  g.connect(ac.destination)
  const t = ac.currentTime
  g.gain.linearRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

export const sound = {
  select() {
    blip(523.25, 0.1, 0.05)
  },
  hover() {
    blip(392.0, 0.05, 0.02)
  },
  era() {
    blip(659.25, 0.14, 0.05)
  },
}
