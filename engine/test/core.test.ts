import { describe, expect, it } from 'vitest';
import { dmath, Rng, World, Runner, ring, box, CONTACT_WALL, CONTACT_BODY, CONTACT_TETHER } from '../src/index';

describe('dmath', () => {
  it('sin/cos match Math closely over a wide range', () => {
    let worst = 0;
    for (let k = -20000; k <= 20000; k++) {
      const x = k * 0.0123;
      worst = Math.max(worst, Math.abs(dmath.sin(x) - Math.sin(x)), Math.abs(dmath.cos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-13);
  });

  it('atan2 matches Math closely in all quadrants', () => {
    let worst = 0;
    for (let a = -50; a <= 50; a++) {
      for (let b = -50; b <= 50; b++) {
        const y = a * 0.37, x = b * 0.29;
        worst = Math.max(worst, Math.abs(dmath.atan2(y, x) - Math.atan2(y, x)));
      }
    }
    expect(worst).toBeLessThan(1e-14);
  });
});

describe('Rng', () => {
  it('is repeatable per seed and differs across seeds', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.u32());
    const sb = Array.from({ length: 50 }, () => b.u32());
    const sc = Array.from({ length: 50 }, () => c.u32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('state round-trips', () => {
    const a = new Rng(7);
    a.u32();
    const st = a.getState();
    const x = a.next();
    a.setState(st);
    expect(a.next()).toBe(x);
  });

  it('is roughly uniform', () => {
    const r = new Rng(1);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) bins[r.int(10)]++;
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500);
  });
});

function ballInRing(gaps: { at: number; width: number }[], speed: number, w = 0) {
  const world = new World({ capacity: 16, maxSpeed: 1e6, maxSubsteps: 512 });
  const col = world.addCollider({ pieces: ring(200, 2, gaps), angularVelocity: w });
  const h = world.createBody({ x: 10, y: 5, vx: speed * 0.6, vy: speed * 0.8, radius: 6 });
  return { world, col, h };
}

describe('walls', () => {
  it('a very fast ball never escapes a closed ring', () => {
    const { world, h } = ballInRing([], 20000);
    const i = world.indexOf(h);
    for (let s = 0; s < 6000; s++) {
      world.step();
      const d = Math.hypot(world.x[i], world.y[i]);
      expect(d).toBeLessThan(200);
    }
    // Elastic walls keep speed.
    expect(Math.hypot(world.vx[i], world.vy[i])).toBeCloseTo(20000, 6);
  });

  it('a ball escapes through a gap eventually', () => {
    const { world, h } = ballInRing([{ at: 1, width: 0.5 }], 900, 0.7);
    const i = world.indexOf(h);
    let escaped = false;
    for (let s = 0; s < 120 * 60 && !escaped; s++) {
      world.step();
      if (Math.hypot(world.x[i], world.y[i]) > 220) escaped = true;
    }
    expect(escaped).toBe(true);
  });

  it('reports one wall contact per bounce', () => {
    const world = new World({ capacity: 4 });
    world.addCollider({ pieces: box(100, 100, 1) });
    world.createBody({ x: 0, y: 0, vx: 300, vy: 0, radius: 5 });
    let hits = 0;
    for (let s = 0; s < 120; s++) {
      world.step();
      for (let k = 0; k < world.contactCount; k++) if (world.cKind[k] === CONTACT_WALL) hits++;
    }
    // 1 second at 300 u/s across an 88-unit free span: 3 or 4 wall hits.
    expect(hits).toBeGreaterThanOrEqual(3);
    expect(hits).toBeLessThanOrEqual(4);
  });
});

describe('bodies', () => {
  it('overlapping pair spanning many cells resolves and reports once', () => {
    const world = new World({ capacity: 4, cellSize: 4 });
    world.createBody({ x: 0, y: 0, vx: 50, radius: 20 });
    world.createBody({ x: 35, y: 0, vx: -50, radius: 20 });
    world.step();
    let n = 0;
    for (let k = 0; k < world.contactCount; k++) if (world.cKind[k] === CONTACT_BODY) n++;
    expect(n).toBe(1);
  });

  it('elastic collisions conserve momentum and energy', () => {
    const world = new World({ capacity: 400 });
    world.addCollider({ pieces: box(600, 600, 2) });
    const rng = new Rng(5);
    for (let k = 0; k < 200; k++) {
      world.createBody({ x: rng.range(-280, 280), y: rng.range(-280, 280), vx: rng.range(-100, 100), vy: rng.range(-100, 100), radius: rng.range(3, 8) });
    }
    const energy = () => {
      let e = 0;
      for (let i = 0; i < world.highWater; i++) {
        if (world.alive[i]) e += (world.vx[i] ** 2 + world.vy[i] ** 2) / world.invMass[i];
      }
      return e;
    };
    for (let s = 0; s < 30; s++) world.step(); // let initial overlaps settle
    const e0 = energy();
    for (let s = 0; s < 600; s++) world.step();
    expect(Math.abs(energy() - e0) / e0).toBeLessThan(0.02);
  });
});

describe('determinism', () => {
  const build = (seed: number) => {
    const world = new World({ capacity: 2000, gravityY: 300 });
    world.addCollider({ pieces: ring(300, 3, [{ at: 4.7, width: 0.4 }]), angularVelocity: 0.9 });
    world.addCollider({ pieces: ring(150, 3, [{ at: 1.0, width: 0.6 }]), angularVelocity: -1.3 });
    const rng = new Rng(seed);
    for (let k = 0; k < 600; k++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0, 280);
      world.createBody({ x: dmath.cos(a) * d, y: dmath.sin(a) * d, vx: rng.range(-200, 200), vy: rng.range(-200, 200), radius: rng.range(2, 5) });
    }
    return world;
  };

  it('same seed produces bit-identical state', () => {
    const a = build(99), b = build(99);
    for (let s = 0; s < 600; s++) { a.step(); b.step(); }
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('different seed diverges', () => {
    const a = build(99), b = build(100);
    for (let s = 0; s < 60; s++) { a.step(); b.step(); }
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('destroy and respawn order stays deterministic', () => {
    const run = () => {
      const w = build(3);
      const rng = new Rng(11);
      for (let s = 0; s < 300; s++) {
        w.step();
        if (s % 10 === 0) {
          const i = rng.int(w.highWater);
          if (w.alive[i]) w.destroyIndex(i);
          w.createBody({ x: 0, y: 0, vx: rng.range(-50, 50), radius: 3 });
        }
      }
      return w.stateHash();
    };
    expect(run()).toBe(run());
  });
});

describe('guards', () => {
  it('object cap refuses spawns past capacity', () => {
    const world = new World({ capacity: 3 });
    for (let k = 0; k < 3; k++) expect(world.createBody({ x: k * 20, y: 0, radius: 1 })).toBeGreaterThanOrEqual(0);
    expect(world.createBody({ x: 0, y: 0, radius: 1 })).toBe(-1);
    expect(world.stats.spawnRefused).toBe(1);
  });

  it('stale handles are rejected after destroy and reuse', () => {
    const world = new World({ capacity: 2 });
    const h = world.createBody({ x: 0, y: 0, radius: 1 });
    world.destroyBody(h);
    const h2 = world.createBody({ x: 0, y: 0, radius: 1 });
    expect(world.indexOf(h2)).toBe(world.indexOf(h2));
    expect(world.isAlive(h)).toBe(false);
    expect(world.isAlive(h2)).toBe(true);
  });

  it('runner slows down instead of piling up steps', () => {
    let t = 0;
    let steps = 0;
    // Each step costs 5ms of fake time; budget 10ms per frame.
    const runner = new Runner(() => { steps++; t += 5; }, { dt: 1 / 120, budgetMs: 10, now: () => t });
    // 1x needs 2 steps (10ms) per frame, which fits the budget.
    for (let f = 0; f < 120; f++) runner.frame(1 / 60);
    expect(runner.overloaded).toBe(false);
    expect(steps).toBe(240);
    runner.speed = 8; // wants 16 steps per frame, budget allows 3
    steps = 0;
    for (let f = 0; f < 120; f++) runner.frame(1 / 60);
    expect(runner.overloaded).toBe(true);
    expect(steps).toBeLessThanOrEqual(120 * 3);
    expect(runner.effectiveSpeed).toBeLessThan(2);
  });
});

describe('tethers', () => {
  it('spring tethers pull a ball toward their anchors', () => {
    const world = new World({ capacity: 4 });
    const h = world.createBody({ x: 0, y: 0, radius: 5, damping: 2 });
    world.addTether({ body: h, anchor: { kind: 'point', x: 100, y: 0 }, restLength: 0, stiffness: 20, damping: 2 });
    world.addTether({ body: h, anchor: { kind: 'point', x: 0, y: 100 }, restLength: 0, stiffness: 20, damping: 2 });
    for (let s = 0; s < 2400; s++) world.step();
    const i = world.indexOf(h);
    expect(world.x[i]).toBeCloseTo(50, 0);
    expect(world.y[i]).toBeCloseTo(50, 0);
  });

  it('collider anchors follow a rotating ring', () => {
    const world = new World({ capacity: 4 });
    const col = world.addCollider({ pieces: ring(100, 2), angularVelocity: Math.PI }); // half turn per second
    const h = world.createBody({ x: 0, y: 0, radius: 2 });
    const th = world.addTether({ body: h, anchor: { kind: 'collider', collider: col, x: 100, y: 0 } });
    for (let s = 0; s < 120; s++) world.step();
    const p = { x: 0, y: 0 };
    world.tetherAnchor(world.tetherIndexOf(th), p);
    expect(p.x).toBeCloseTo(-100, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('reports other balls crossing a tether, not the owner', () => {
    const world = new World({ capacity: 4 });
    const owner = world.createBody({ x: 0, y: 0, radius: 4, fixed: true });
    world.addTether({ body: owner, anchor: { kind: 'point', x: 200, y: 0 } });
    world.createBody({ x: 100, y: -30, vy: 300, radius: 4 });
    let touches = 0;
    for (let s = 0; s < 30; s++) {
      world.step();
      for (let k = 0; k < world.contactCount; k++) {
        if (world.cKind[k] === CONTACT_TETHER) {
          touches++;
          expect(world.cB[k]).toBe(world.indexOf(owner));
        }
      }
    }
    expect(touches).toBeGreaterThan(0);
  });

  it('destroying a body removes its tethers and fixes counts', () => {
    const world = new World({ capacity: 4 });
    const a = world.createBody({ x: 0, y: 0, radius: 2 });
    const b = world.createBody({ x: 50, y: 0, radius: 2 });
    world.addTether({ body: a, anchor: { kind: 'body', body: b } });
    world.addTether({ body: a, anchor: { kind: 'point', x: 0, y: 50 } });
    expect(world.tetherCount[world.indexOf(a)]).toBe(2);
    expect(world.tetherCount[world.indexOf(b)]).toBe(1);
    world.destroyBody(a);
    expect(world.tetherAliveCount).toBe(0);
    expect(world.tetherCount[world.indexOf(b)]).toBe(0);
  });
});
