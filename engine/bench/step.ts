// Run: npx vite-node engine/bench/step.ts
import { World, ring, Rng, dmath } from '../src/index';
for (const n of [1000, 5000, 10000]) {
  const w = new World({ capacity: n + 10, gravityY: 400, cellSize: 8 });
  w.addCollider({ pieces: ring(500, 3, [{ at: 1, width: 0.3 }]), angularVelocity: 0.8 });
  w.addCollider({ pieces: ring(1000, 3) });
  const rng = new Rng(1);
  for (let k = 0; k < n; k++) {
    const a = rng.range(0, 6.28), d = rng.range(0, 480);
    w.createBody({ x: dmath.cos(a) * d, y: dmath.sin(a) * d, vx: rng.range(-100, 100), vy: rng.range(-100, 100), radius: 2.5 });
  }
  for (let s = 0; s < 120; s++) w.step();
  const t0 = performance.now();
  for (let s = 0; s < 240; s++) w.step();
  console.log(`${n} balls: ${((performance.now() - t0) / 240).toFixed(2)} ms/step`);
}
