/**
 * A short two-tone chime through Web Audio (no audio file). Silently does
 * nothing where Web Audio is missing or the browser blocks playback.
 */
export function playChime(): void {
  try {
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const start = ctx.currentTime
    for (const [offset, freq] of [
      [0, 880],
      [0.22, 660],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.22)
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), 800)
  } catch {
    // Audio is optional.
  }
}
