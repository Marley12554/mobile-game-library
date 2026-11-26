/**
 * Tiny synth sound effects. No audio files: every sound is a short envelope on
 * an oscillator or a noise buffer. Each sound has a minimum gap so a big squad
 * doesn't turn into static.
 */
type Spec = { gap: number; fn: (a: AudioContext, out: AudioNode, t: number) => void };

export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  enabled = true;

  /** Must be called from a user gesture on iOS. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  play(name: string): void {
    if (!this.enabled || !this.ctx || !this.out) return;
    const spec = SOUNDS[name];
    if (!spec) return;
    const now = this.ctx.currentTime;
    const l = this.last.get(name) ?? -1;
    if (now - l < spec.gap) return;
    this.last.set(name, now);
    spec.fn(this.ctx, this.out, now);
  }

  noiseBuf(): AudioBuffer | null { return this.noise; }
}

let shared: Sound | null = null;

function tone(a: AudioContext, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(a: AudioContext, out: AudioNode, t: number, dur: number, vol: number, freq: number, q = 1): void {
  const buf = shared?.noiseBuf();
  if (!buf) return;
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const SOUNDS: Record<string, Spec> = {
  hit: { gap: 0.05, fn: (a, o, t) => noise(a, o, t, 0.04, 0.08, 2400, 2) },
  clank: { gap: 0.08, fn: (a, o, t) => tone(a, o, t, 'square', 1400, 900, 0.05, 0.05) },
  kill: { gap: 0.045, fn: (a, o, t) => tone(a, o, t, 'triangle', 420 + Math.random() * 120, 120, 0.09, 0.14) },
  down: { gap: 0.06, fn: (a, o, t) => tone(a, o, t, 'sine', 300, 90, 0.14, 0.16) },
  tick: { gap: 0.04, fn: (a, o, t) => tone(a, o, t, 'sine', 900, 1300, 0.05, 0.08) },
  ice: { gap: 0.05, fn: (a, o, t) => tone(a, o, t, 'triangle', 2200 + Math.random() * 600, 1600, 0.04, 0.06) },
  gateGood: { gap: 0.1, fn: (a, o, t) => { tone(a, o, t, 'triangle', 520, 1040, 0.18, 0.2); tone(a, o, t + 0.06, 'triangle', 780, 1560, 0.2, 0.14); } },
  gateBad: { gap: 0.1, fn: (a, o, t) => tone(a, o, t, 'sawtooth', 300, 110, 0.3, 0.16) },
  boom: { gap: 0.06, fn: (a, o, t) => { noise(a, o, t, 0.35, 0.4, 300, 0.7); tone(a, o, t, 'sine', 120, 40, 0.3, 0.3); } },
  shatter: { gap: 0.2, fn: (a, o, t) => { noise(a, o, t, 0.5, 0.35, 4000, 0.6); tone(a, o, t, 'triangle', 660, 1320, 0.4, 0.18); tone(a, o, t + 0.1, 'triangle', 990, 1980, 0.4, 0.14); } },
  roar: { gap: 0.4, fn: (a, o, t) => { tone(a, o, t, 'sawtooth', 160, 60, 0.5, 0.16); noise(a, o, t, 0.4, 0.12, 500, 1); } },
  nova: { gap: 0.3, fn: (a, o, t) => tone(a, o, t, 'sine', 1800, 300, 0.5, 0.2) },
  throw: { gap: 0.2, fn: (a, o, t) => tone(a, o, t, 'sine', 500, 900, 0.15, 0.1) },
  win: { gap: 1, fn: (a, o, t) => [523, 659, 784, 1046].forEach((f, k) => tone(a, o, t + k * 0.1, 'triangle', f, f, 0.25, 0.2)) },
  lose: { gap: 1, fn: (a, o, t) => [392, 330, 262].forEach((f, k) => tone(a, o, t + k * 0.16, 'triangle', f, f * 0.98, 0.3, 0.2)) },
  click: { gap: 0.03, fn: (a, o, t) => tone(a, o, t, 'sine', 700, 500, 0.05, 0.12) },
};

export function getSound(): Sound {
  if (!shared) shared = new Sound();
  return shared;
}
