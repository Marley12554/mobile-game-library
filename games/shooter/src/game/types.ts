export type WeaponId = 'rifle' | 'spread' | 'piercer' | 'launcher' | 'frost';
export type EnemyKind = 'zombie' | 'runner' | 'armored' | 'splitter' | 'splitling' | 'shielded' | 'thief' | 'brute';
export type SquadType = 'rookies' | 'heavies' | 'scouts' | 'engineers';
export type AbilityId = 'grenade' | 'barricade' | 'nova' | 'overclock';
export type BossKind = 'bruteKing' | 'ironHulk' | 'broodMother' | 'warden' | 'gateEater';

/* ---------------- Level data (what the JSON files hold) ---------------- */

/** A solid barrier from y to y+h, spanning x0..x1. Blocks the squad, enemies and bullets. */
export interface WallData { y: number; h: number; x0: number; x1: number }

/**
 * A gate. `m` is its effect, comma separated: "+5", "-10", "x2", "/2",
 * "fire+50%", "dmg-30%", "pierce+1", "weapon:piercer".
 * Gates at the same y form a row: taking one removes the rest.
 */
export interface GateData {
  y: number;
  x: number;
  w?: number;
  m: string;
  /** Shootable: damage needed to raise the first +N or xN by one. */
  shoot?: number;
  /** Cap for a shootable gate's value. */
  max?: number;
  /** Slides side to side: [amplitude, period seconds]. */
  move?: [number, number];
  /** Flips between `m` and `alt` every `period` seconds. */
  alt?: string;
  period?: number;
}

export type Formation = 'block' | 'line' | 'column' | 'scatter';

/** A group of enemies, created when it comes into range. */
export interface WaveData {
  y: number;
  t: EnemyKind;
  n: number;
  f?: Formation;
  x?: number;
  w?: number;
  d?: number;
}

/** A frozen prize. `r` is the reward: "mech", "weapon:launcher", "soldiers:20". */
export interface PrizeData { y: number; x: number; hp: number; r: string }

export interface BossData { kind: BossKind; hp: number }

export interface LevelData {
  id: string;
  name: string;
  /** Finish line (or, for boss levels, where the arena starts). */
  length: number;
  /** Forward speed of the squad, units/s. */
  scroll: number;
  /** Starting soldiers before loadout and upgrades. */
  start: number;
  /** Survivors needed for the survivor stars: [star 2 if no prize, star 3]. */
  stars: [number, number];
  hint?: string;
  walls?: WallData[];
  gates?: GateData[];
  waves?: WaveData[];
  prizes?: PrizeData[];
  boss?: BossData;
}

export interface WorldData {
  id: number;
  name: string;
  intro: string;
  levels: LevelData[];
}

/* ---------------- Run setup ---------------- */

export interface Loadout {
  weapon: WeaponId;
  squad: SquadType;
  ability: AbilityId;
}

/** Permanent upgrade levels, by upgrade id. */
export type Perks = Record<string, number>;

export type Outcome = 'win' | 'lose';
