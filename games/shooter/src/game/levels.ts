import type { LevelData, WorldData } from './types';
import w1 from '../../levels/w1.json';
import w2 from '../../levels/w2.json';
import w3 from '../../levels/w3.json';
import w4 from '../../levels/w4.json';
import w5 from '../../levels/w5.json';

export const WORLDS: WorldData[] = [w1, w2, w3, w4, w5] as WorldData[];
export const ALL_LEVELS: LevelData[] = WORLDS.flatMap((w) => w.levels);

export function findLevel(id: string): { world: WorldData; level: LevelData; index: number } | null {
  for (const world of WORLDS) {
    const index = world.levels.findIndex((l) => l.id === id);
    if (index >= 0) return { world, level: world.levels[index], index };
  }
  return null;
}

export function nextLevelId(id: string): string | null {
  const k = ALL_LEVELS.findIndex((l) => l.id === id);
  return k >= 0 && k + 1 < ALL_LEVELS.length ? ALL_LEVELS[k + 1].id : null;
}
