/** Pooled particles in world coordinates. Visual only: never touches the sim. */
export const P_CHUNK = 0, P_SPARK = 1, P_RING = 2, P_SHARD = 3, P_SMOKE = 4;

export class Particles {
  readonly cap: number;
  n = 0;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  life: Float32Array; max: Float32Array; size: Float32Array; kind: Uint8Array;
  color: string[];

  constructor(cap = 3000) {
    this.cap = cap;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size = new Float32Array(cap); this.kind = new Uint8Array(cap);
    this.color = new Array(cap).fill('#fff');
  }

  add(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.color[i] = color;
  }

  burst(kind: number, x: number, y: number, n: number, speed: number, life: number, size: number, color: string): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add(kind, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.7), color);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; ) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        this.kind[i] = this.kind[l]; this.x[i] = this.x[l]; this.y[i] = this.y[l];
        this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.life[i] = this.life[l];
        this.max[i] = this.max[l]; this.size[i] = this.size[l]; this.color[i] = this.color[l];
        continue;
      }
      const drag = this.kind[i] === P_SMOKE ? 0.9 : 0.94;
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }
}

export interface Pop {
  x: number; y: number; text: string; color: string; size: number; t: number; dur: number;
}
