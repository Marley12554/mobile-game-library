import type { AbilityId, EnemyKind, LevelData, SquadType, WeaponId } from '../game/types';
import { ALL_LEVELS, WORLDS } from '../game/levels';
import { UPGRADES } from '../game/loadout';
import { WEAPON_ORDER } from '../game/weapons';
import type { SaveData } from './save';

/** Permanent unlocks are options, not power: each one is a new way to play. */
const WEAPON_UNLOCK: Record<WeaponId, string | null> = { rifle: null, piercer: '1-8', launcher: '2-8', spread: '3-8', frost: '4-8' };
const SQUAD_UNLOCK: Record<SquadType, string | null> = { rookies: null, heavies: '1-8', scouts: '2-8', engineers: '3-8' };
const ABILITY_UNLOCK: Record<AbilityId, string | null> = { grenade: null, barricade: '1-5', nova: '2-8', overclock: '3-5' };

export const cleared = (s: SaveData, id: string | null) => id === null || (s.stars[id] ?? 0) > 0;

export function levelUnlocked(s: SaveData, id: string): boolean {
  const k = ALL_LEVELS.findIndex((l) => l.id === id);
  return k === 0 || (k > 0 && cleared(s, ALL_LEVELS[k - 1].id));
}

export function worldUnlocked(s: SaveData, w: number): boolean {
  return levelUnlocked(s, WORLDS[w].levels[0].id);
}

export const weaponUnlocked = (s: SaveData, w: WeaponId) => cleared(s, WEAPON_UNLOCK[w]);
export const squadUnlocked = (s: SaveData, q: SquadType) => cleared(s, SQUAD_UNLOCK[q]);
export const abilityUnlocked = (s: SaveData, a: AbilityId) => cleared(s, ABILITY_UNLOCK[a]);

export function unlockSource(kind: 'weapon' | 'squad' | 'ability', id: string): string | null {
  const t = kind === 'weapon' ? WEAPON_UNLOCK : kind === 'squad' ? SQUAD_UNLOCK : ABILITY_UNLOCK;
  return (t as Record<string, string | null>)[id];
}

/** Names of everything that clearing `id` unlocks for the first time. */
export function unlocksFrom(id: string): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(WEAPON_UNLOCK)) if (v === id) out.push(`Weapon: ${cap(k)}`);
  for (const [k, v] of Object.entries(SQUAD_UNLOCK)) if (v === id) out.push(`Squad: ${cap(k)}`);
  for (const [k, v] of Object.entries(ABILITY_UNLOCK)) if (v === id) out.push(`Ability: ${k === 'nova' ? 'Frost Nova' : cap(k)}`);
  const lvl = ALL_LEVELS.findIndex((l) => l.id === id);
  const w = WORLDS.findIndex((wd) => wd.levels[wd.levels.length - 1].id === id);
  if (w >= 0 && w + 1 < WORLDS.length && lvl >= 0) out.push(`World ${w + 2}: ${WORLDS[w + 1].name}`);
  return out;
}

function cap(s: string): string {
  return s === 'frost' ? 'Frost Beam' : s[0].toUpperCase() + s.slice(1);
}

export function totalStars(s: SaveData): number {
  return Object.values(s.stars).reduce((a, b) => a + b, 0);
}

export function spentStars(s: SaveData): number {
  let n = 0;
  for (const u of UPGRADES) {
    const lv = s.upgrades[u.id] ?? 0;
    for (let k = 0; k < lv; k++) n += u.costs[k];
  }
  return n;
}

export const freeStars = (s: SaveData) => totalStars(s) - spentStars(s);

export function buyUpgrade(s: SaveData, id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  const lv = s.upgrades[id] ?? 0;
  if (lv >= u.costs.length || freeStars(s) < u.costs[lv]) return false;
  s.upgrades[id] = lv + 1;
  return true;
}

export function refundAll(s: SaveData): void { s.upgrades = {}; }

/** Make sure the saved loadout only uses unlocked things. */
export function fixLoadout(s: SaveData): void {
  if (!weaponUnlocked(s, s.loadout.weapon)) s.loadout.weapon = 'rifle';
  if (!squadUnlocked(s, s.loadout.squad)) s.loadout.squad = 'rookies';
  if (!abilityUnlocked(s, s.loadout.ability)) s.loadout.ability = 'grenade';
  void WEAPON_ORDER;
}

/** Enemy kinds a level throws at you, for the briefing. */
export function threatsOf(l: LevelData): EnemyKind[] {
  const set = new Set<EnemyKind>();
  for (const w of l.waves ?? []) set.add(w.t);
  if (l.boss) {
    const extra: Record<string, EnemyKind[]> = {
      bruteKing: ['zombie', 'runner'], ironHulk: ['armored', 'zombie'], broodMother: ['splitter', 'zombie'],
      warden: ['shielded', 'zombie'], gateEater: ['thief', 'zombie', 'runner', 'armored'],
    };
    for (const k of extra[l.boss.kind]) set.add(k);
  }
  set.delete('splitling');
  return [...set];
}
