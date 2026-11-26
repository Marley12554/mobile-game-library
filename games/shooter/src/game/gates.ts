import type { WeaponId } from './types';
import { WEAPONS } from './weapons';

export type Mod =
  | { k: 'add'; v: number }
  | { k: 'mul'; v: number }
  | { k: 'div'; v: number }
  | { k: 'fire'; v: number }
  | { k: 'dmg'; v: number }
  | { k: 'pierce'; v: number }
  | { k: 'weapon'; id: WeaponId };

/** Parse a gate effect string like "fire+50%, dmg-30%". Throws on bad input so level tests catch typos. */
export function parseMods(s: string): Mod[] {
  return s.split(',').map((raw) => {
    const t = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^([+-]\d+)$/))) return { k: 'add', v: Number(m[1]) };
    if ((m = t.match(/^x(\d+(?:\.\d+)?)$/))) return { k: 'mul', v: Number(m[1]) };
    if ((m = t.match(/^\/(\d+)$/))) return { k: 'div', v: Number(m[1]) };
    if ((m = t.match(/^(fire|dmg)([+-]\d+)%$/))) return { k: m[1] as 'fire' | 'dmg', v: 1 + Number(m[2]) / 100 };
    if ((m = t.match(/^pierce\+(\d+)$/))) return { k: 'pierce', v: Number(m[1]) };
    if ((m = t.match(/^weapon:(\w+)$/)) && m[1] in WEAPONS) return { k: 'weapon', id: m[1] as WeaponId };
    throw new Error(`bad gate effect "${t}"`);
  });
}

export function modGood(m: Mod): boolean {
  switch (m.k) {
    case 'add': return m.v > 0;
    case 'mul': return m.v >= 1;
    case 'div': return false;
    case 'fire': case 'dmg': return m.v >= 1;
    case 'pierce': return m.v > 0;
    case 'weapon': return true;
  }
}

export type Tone = 'good' | 'bad' | 'mixed' | 'weapon';

export function toneOf(mods: Mod[]): Tone {
  if (mods.some((m) => m.k === 'weapon')) return 'weapon';
  const g = mods.filter(modGood).length;
  return g === mods.length ? 'good' : g === 0 ? 'bad' : 'mixed';
}

/** Big text first line, then small lines for stat effects. */
export function modLabel(m: Mod): string {
  switch (m.k) {
    case 'add': return m.v >= 0 ? `+${m.v}` : `${m.v}`;
    case 'mul': return `x${m.v}`;
    case 'div': return `÷${m.v}`;
    case 'fire': return `FIRE ${pct(m.v)}`;
    case 'dmg': return `DMG ${pct(m.v)}`;
    case 'pierce': return `PIERCE +${m.v}`;
    case 'weapon': return WEAPONS[m.id].name.toUpperCase();
  }
}

function pct(v: number): string {
  const p = Math.round((v - 1) * 100);
  return p >= 0 ? `+${p}%` : `${p}%`;
}
