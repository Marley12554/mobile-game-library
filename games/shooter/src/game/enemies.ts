import type { EnemyKind } from './types';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  blurb: string;
  hp: number;
  speed: number;
  r: number;
  /** Soldiers it can take down before it's used up. */
  bites: number;
  /** Flat damage removed from every hit (see armored()). */
  armor: number;
  /** Shield HP. Blocks straight shots until broken. Angled shots and explosions go around it. */
  shield: number;
  /** How far ahead of the squad it starts steering toward it. */
  home: number;
  /** Sideways steering speed as a fraction of its speed. */
  lat: number;
  /** Holds its spawn lane until close. */
  lane: boolean;
  /** Children on death: n from bullets, n * 2 from explosions. */
  split?: { kind: EnemyKind; n: number };
  /** Heads for gates instead of the squad and turns them negative. */
  thief: boolean;
}

const base = { armor: 0, shield: 0, lane: false, thief: false, lat: 0.8, home: 220 };

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  zombie: { ...base, kind: 'zombie', name: 'Zombie', blurb: 'Slow, comes in crowds.', hp: 4, speed: 60, r: 6.5, bites: 1, home: 280, lat: 0.9 },
  runner: { ...base, kind: 'runner', name: 'Runner', blurb: 'Fast. Sticks to its lane.', hp: 2, speed: 150, r: 5.5, bites: 1, lane: true, home: 70, lat: 1.3 },
  armored: { ...base, kind: 'armored', name: 'Armored', blurb: 'Shrugs off weak hits. Needs piercing or big damage.', hp: 6, speed: 44, r: 8.5, bites: 2, armor: 0.75, lat: 0.6 },
  splitter: { ...base, kind: 'splitter', name: 'Splitter', blurb: 'Bursts into fast little ones. Explosions make it burst into more.', hp: 7, speed: 50, r: 9.5, bites: 2, split: { kind: 'splitling', n: 2 } },
  splitling: { ...base, kind: 'splitling', name: 'Splitling', blurb: '', hp: 1.2, speed: 96, r: 4.5, bites: 1, home: 280, lat: 1.2 },
  shielded: { ...base, kind: 'shielded', name: 'Shielded', blurb: 'Blocks straight shots. Hit it at an angle or blow it up.', hp: 6, speed: 46, r: 8, bites: 2, shield: 14, lat: 0.6 },
  thief: { ...base, kind: 'thief', name: 'Gate Thief', blurb: 'Runs into good gates and turns them bad.', hp: 4, speed: 84, r: 6, bites: 1, thief: true, lat: 1.4 },
  brute: { ...base, kind: 'brute', name: 'Brute', blurb: 'Huge. Takes a lot to put down.', hp: 45, speed: 28, r: 14, bites: 6, armor: 0.3, lat: 0.4 },
};
