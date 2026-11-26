import { describe, expect, it } from 'vitest';
import { WORLDS, ALL_LEVELS } from '../src/game/levels';
import { parseMods } from '../src/game/gates';
import { Sim } from '../src/game/sim';
import { botStep, newBot } from '../src/game/bot';
import { ENEMIES } from '../src/game/enemies';
import { WEAPONS } from '../src/game/weapons';
import { TRACK_HALF } from '../src/game/config';
import type { Loadout } from '../src/game/types';

const LO: Loadout = { weapon: 'rifle', squad: 'rookies', ability: 'grenade' };

describe('level data', () => {
  it('has 5 worlds of 8 levels, each ending in a boss', () => {
    expect(WORLDS.length).toBe(5);
    for (const w of WORLDS) {
      expect(w.levels.length).toBe(8);
      expect(w.levels[7].boss).toBeTruthy();
      for (const l of w.levels.slice(0, 7)) expect(l.boss).toBeFalsy();
    }
  });

  it('has unique ids in world-level order', () => {
    const ids = ALL_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    WORLDS.forEach((w, wi) => w.levels.forEach((l, li) => expect(l.id).toBe(`${wi + 1}-${li + 1}`)));
  });

  for (const l of ALL_LEVELS) {
    it(`${l.id} is well formed`, () => {
      expect(l.length).toBeGreaterThan(1000);
      expect(l.stars[1]).toBeGreaterThan(l.stars[0]);
      for (const g of l.gates ?? []) {
        expect(() => parseMods(g.m)).not.toThrow();
        if (g.alt) expect(() => parseMods(g.alt!)).not.toThrow();
        expect(Math.abs(g.x)).toBeLessThanOrEqual(TRACK_HALF);
        expect(g.y).toBeLessThan(l.length);
      }
      for (const w of l.waves ?? []) {
        expect(ENEMIES[w.t]).toBeTruthy();
        expect(w.n).toBeGreaterThan(0);
        expect(Math.abs(w.x ?? 0)).toBeLessThanOrEqual(TRACK_HALF);
      }
      for (const p of l.prizes ?? []) {
        const [k, a] = p.r.split(':');
        expect(['mech', 'weapon', 'soldiers']).toContain(k);
        if (k === 'weapon') expect(WEAPONS[a as keyof typeof WEAPONS]).toBeTruthy();
      }
      for (const w of l.walls ?? []) expect(w.x1).toBeGreaterThan(w.x0);
    });
  }
});

describe('simulation', () => {
  it('runs every level for a while with the bot without errors', () => {
    for (const l of ALL_LEVELS) {
      const s = new Sim(l, LO, {}, 3);
      s.fxOn = false;
      const bot = newBot();
      for (let k = 0; k < 60 * 12 && !s.result; k++) { botStep(s, bot); s.step(); }
      expect(Number.isFinite(s.squadY)).toBe(true);
      expect(s.count).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const l = ALL_LEVELS.find((x) => x.id === '2-5')!;
    const run = () => {
      const s = new Sim(l, { weapon: 'piercer', squad: 'heavies', ability: 'grenade' }, { caliber: 2 }, 11);
      s.fxOn = false;
      const bot = newBot();
      for (let k = 0; k < 60 * 15; k++) { botStep(s, bot); s.step(); }
      return [s.world.stateHash(), s.count, s.kills, s.enemies.length];
    };
    expect(run()).toEqual(run());
  });

  it('loses if you never grow or move on a later level', () => {
    const l = ALL_LEVELS.find((x) => x.id === '3-5')!;
    const s = new Sim(l, LO, {}, 1);
    s.fxOn = false;
    for (let k = 0; k < 60 * 200 && !s.result; k++) s.step();
    expect(s.result).toBe('lose');
  });

  it('a + gate adds soldiers and a frozen prize breaks into a mech', () => {
    const s = new Sim({
      id: 't', name: 't', length: 900, scroll: 70, start: 5, stars: [1, 2],
      gates: [{ y: 100, x: 0, w: 200, m: '+7' }], prizes: [{ y: 400, x: 0, hp: 20, r: 'mech' }],
    }, LO, {}, 1);
    s.fxOn = false;
    for (let k = 0; k < 60 * 14 && !s.result; k++) s.step();
    expect(s.result).toBe('win');
    expect(s.count).toBe(12);
    expect(s.prizes[0].state).toBe('broken');
    expect(s.mech).toBeTruthy();
  });
});
