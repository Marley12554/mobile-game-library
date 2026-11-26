import { dmath } from '@engine/index';
import type { WeaponId } from './types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  strong: string;
  weak: string;
  dmg: number;
  /** Shots per second per soldier. */
  rate: number;
  speed: number;
  /** Seconds before a bullet fizzles. Range = speed * life. */
  life: number;
  /** Pellet angles, degrees from straight ahead. */
  spread: number[];
  /** Extra enemies a bullet passes through. */
  pierce: number;
  /** Explosion radius on impact. Explosions ignore shields. */
  splash: number;
  /** Seconds of slow applied on hit. */
  slow: number;
  ignoreArmor: boolean;
  look: 'bullet' | 'pellet' | 'lance' | 'shell' | 'frost';
}

// Every weapon is strong against something and weak against something else.
// None of them is a straight upgrade on another.
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle', name: 'Rifle', strong: 'Long range, good all-round', weak: 'Armor and shields',
    dmg: 1, rate: 3, speed: 820, life: 0.64, spread: [0], pierce: 0, splash: 0, slow: 0, ignoreArmor: false, look: 'bullet',
  },
  piercer: {
    id: 'piercer', name: 'Piercer', strong: 'Armor, enemies in a line', weak: 'Slow to fire, blocked by shields',
    dmg: 1.6, rate: 0.95, speed: 1050, life: 0.6, spread: [0], pierce: 2, splash: 0, slow: 0, ignoreArmor: true, look: 'lance',
  },
  launcher: {
    id: 'launcher', name: 'Launcher', strong: 'Packed crowds, breaks through shields', weak: 'Splitters burst wider, fast runners',
    dmg: 2.2, rate: 0.62, speed: 540, life: 0.8, spread: [0], pierce: 0, splash: 24, slow: 0, ignoreArmor: false, look: 'shell',
  },
  spread: {
    id: 'spread', name: 'Spread', strong: 'Wide swarms, angled shots get past shields', weak: 'Short range, armor',
    dmg: 0.6, rate: 2.2, speed: 700, life: 0.5, spread: [-15, 0, 15], pierce: 0, splash: 0, slow: 0, ignoreArmor: false, look: 'pellet',
  },
  frost: {
    id: 'frost', name: 'Frost Beam', strong: 'Slows runners and bosses', weak: 'Very short range, low damage',
    dmg: 0.58, rate: 7, speed: 700, life: 0.45, spread: [0], pierce: 0, splash: 0, slow: 0.8, ignoreArmor: false, look: 'frost',
  },
};

export const WEAPON_ORDER: WeaponId[] = ['rifle', 'piercer', 'launcher', 'spread', 'frost'];

/** Precomputed unit directions for each pellet, using deterministic math. */
export const PELLET_DIRS: Record<WeaponId, { x: number; y: number }[]> = {} as never;
for (const w of WEAPON_ORDER) {
  PELLET_DIRS[w] = WEAPONS[w].spread.map((deg) => {
    const a = (deg * dmath.PI) / 180;
    return { x: dmath.sin(a), y: dmath.cos(a) };
  });
}

/** Damage after flat armor, never below 10%. */
export function armored(dmg: number, armor: number, ignore: boolean): number {
  if (ignore || armor <= 0) return dmg;
  return Math.max(dmg * 0.1, dmg - armor);
}
