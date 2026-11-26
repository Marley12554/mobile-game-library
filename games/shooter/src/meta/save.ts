import type { Loadout, Perks } from '../game/types';

/** Everything that persists between sessions. Kept apart from gameplay so a shared shell can own it later. */
export interface SaveData {
  v: 1;
  /** Best stars per level id. */
  stars: Record<string, number>;
  /** Best survivors per level id. */
  best: Record<string, number>;
  upgrades: Perks;
  loadout: Loadout;
  sound: boolean;
}

const KEY = 'mgl.shooter.v1';

export function defaultSave(): SaveData {
  return { v: 1, stars: {}, best: {}, upgrades: {}, loadout: { weapon: 'rifle', squad: 'rookies', ability: 'grenade' }, sound: true };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    return { ...defaultSave(), ...d, loadout: { ...defaultSave().loadout, ...(d.loadout ?? {}) } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(d: SaveData): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: progress lasts this session only */ }
}
