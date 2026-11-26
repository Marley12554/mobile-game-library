import type { AbilityId, Loadout, Perks, SquadType } from './types';

export interface SquadDef {
  id: SquadType;
  name: string;
  blurb: string;
  startMul: number;
  /** Multiplier on +N gates (x gates are unchanged). */
  addMul: number;
  hp: number;
  dmg: number;
  fire: number;
  move: number;
  prize: number;
  cooldown: number;
  radius: number;
}

const sq = { startMul: 1, addMul: 1, hp: 1, dmg: 1, fire: 1, move: 1, prize: 1, cooldown: 1, radius: 5 };

export const SQUADS: Record<SquadType, SquadDef> = {
  rookies: { ...sq, id: 'rookies', name: 'Rookies', blurb: 'The standard squad. Nothing special, nothing missing.' },
  heavies: {
    ...sq, id: 'heavies', name: 'Heavies', blurb: 'Fewer, tougher soldiers. Hit hard, take two bites each, get half from + gates.',
    startMul: 0.6, addMul: 0.5, hp: 2, dmg: 1.6, radius: 6.5,
  },
  scouts: {
    ...sq, id: 'scouts', name: 'Scouts', blurb: 'Quick on their feet and fast on the trigger, but each shot hits softer.',
    move: 1.6, fire: 1.3, dmg: 0.75,
  },
  engineers: {
    ...sq, id: 'engineers', name: 'Engineers', blurb: 'Crack ice fast and recharge abilities sooner. Weaker against the horde.',
    prize: 1.6, cooldown: 0.65, dmg: 0.85,
  },
};
export const SQUAD_ORDER: SquadType[] = ['rookies', 'heavies', 'scouts', 'engineers'];

export interface AbilityDef { id: AbilityId; name: string; blurb: string; cooldown: number }

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  grenade: { id: 'grenade', name: 'Grenade', blurb: 'Lob a grenade ahead of the squad. Big blast, ignores shields.', cooldown: 12 },
  barricade: { id: 'barricade', name: 'Barricade', blurb: 'Drop a wall ahead that holds enemies back for a few seconds.', cooldown: 18 },
  nova: { id: 'nova', name: 'Frost Nova', blurb: 'Freeze everything on screen to a crawl for a few seconds.', cooldown: 24 },
  overclock: { id: 'overclock', name: 'Overclock', blurb: 'Double fire rate for four seconds.', cooldown: 20 },
};
export const ABILITY_ORDER: AbilityId[] = ['grenade', 'barricade', 'nova', 'overclock'];

/** Permanent upgrades bought with stars. Low caps on purpose: they help, they never carry. */
export interface UpgradeDef { id: string; name: string; blurb: string; costs: number[] }

export const UPGRADES: UpgradeDef[] = [
  { id: 'recruits', name: 'Recruits', blurb: '+1 starting soldier', costs: [2, 3, 4, 5, 6] },
  { id: 'caliber', name: 'Caliber', blurb: '+6% damage', costs: [3, 5, 7] },
  { id: 'trigger', name: 'Trigger', blurb: '+6% fire rate', costs: [3, 5, 7] },
  { id: 'icepick', name: 'Ice Pick', blurb: '+20% damage to frozen prizes', costs: [2, 4] },
  { id: 'quick', name: 'Quick Hands', blurb: '-10% ability cooldown', costs: [3, 5] },
];

/** Everything about the squad that's fixed at the start of a run. */
export interface RunStats {
  start: number;
  addMul: number;
  soldierHp: number;
  soldierR: number;
  dmg: number;
  fire: number;
  move: number;
  prize: number;
  cooldown: number;
}

export function runStats(levelStart: number, lo: Loadout, perks: Perks): RunStats {
  const s = SQUADS[lo.squad];
  const p = (id: string) => perks[id] ?? 0;
  return {
    start: Math.max(1, Math.ceil(levelStart * s.startMul) + Math.ceil(p('recruits') * s.startMul)),
    addMul: s.addMul,
    soldierHp: s.hp,
    soldierR: s.radius,
    dmg: s.dmg * (1 + 0.06 * p('caliber')),
    fire: s.fire * (1 + 0.06 * p('trigger')),
    move: s.move,
    prize: s.prize * (1 + 0.2 * p('icepick')),
    cooldown: s.cooldown * (1 - 0.1 * p('quick')),
  };
}
