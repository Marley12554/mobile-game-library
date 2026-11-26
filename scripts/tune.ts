/**
 * Headless tuning report: plays every level with the bot.
 *   npx vite-node -c vitest.config.ts scripts/tune.ts [levelIdPrefix] [seeds]
 * For each level it tries every weapon unlocked by then (rookies, grenade),
 * plus an idle run that never moves. Read it as a yardstick, not a verdict.
 */
import { Sim } from '../games/shooter/src/game/sim';
import { botStep, newBot } from '../games/shooter/src/game/bot';
import { ALL_LEVELS } from '../games/shooter/src/game/levels';
import { WEAPON_ORDER } from '../games/shooter/src/game/weapons';
import type { LevelData, Loadout, WeaponId } from '../games/shooter/src/game/types';

const prefix = process.argv[2] ?? '';
const seeds = Number(process.argv[3] ?? 3);
const UNLOCK: Record<WeaponId, number> = { rifle: 1, piercer: 2, launcher: 3, spread: 4, frost: 5 };

function run(l: LevelData, lo: Loadout, seed: number, bot: boolean) {
  const s = new Sim(l, lo, {}, seed);
  s.fxOn = false;
  const mem = newBot();
  let n = 0;
  while (!s.result && n < 60 * 240) { if (bot) botStep(s, mem); else s.targetX = 0; s.step(); n++; }
  return { win: s.result === 'win', lost: s.lostSoldiers, n: s.count, peak: s.peak, stars: s.stars, prize: s.prizes.filter((p) => p.state === 'broken').length, t: s.time, boss: s.boss ? Math.round((s.boss.hp / s.boss.maxHp) * 100) : -1 };
}

console.log('level  weapon     wins  avgSurv  peak  lost  stars  prize  bossHP%  | idle');
for (const l of ALL_LEVELS) {
  if (!l.id.startsWith(prefix)) continue;
  const world = Number(l.id.split('-')[0]);
  const idle = run(l, { weapon: 'rifle', squad: 'rookies', ability: 'grenade' }, 1, false);
  for (const w of WEAPON_ORDER) {
    if (UNLOCK[w] > world) continue;
    const rs = Array.from({ length: seeds }, (_, k) => run(l, { weapon: w, squad: 'rookies', ability: 'grenade' }, k + 1, true));
    const wins = rs.filter((r) => r.win).length;
    const avg = (f: (r: (typeof rs)[0]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(0);
    console.log(
      `${l.id.padEnd(6)} ${w.padEnd(10)} ${wins}/${seeds}   ${avg((r) => r.n).padStart(5)}  ${avg((r) => r.peak).padStart(5)} ${avg((r) => r.lost).padStart(5)}  ${avg((r) => r.stars).padStart(4)}  ${avg((r) => r.prize).padStart(4)}  ${avg((r) => r.boss).padStart(6)}   | ${idle.win ? 'WIN ' + idle.n : 'lose'}`,
    );
  }
}
