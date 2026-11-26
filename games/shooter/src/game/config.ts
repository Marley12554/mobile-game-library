/** Fixed simulation step. 60 Hz keeps phones cool; the engine is deterministic at any fixed step. */
export const DT = 1 / 60;
/** Half the width of the track in world units. The view is VIEW_W wide. */
export const TRACK_HALF = 170;
export const VIEW_W = 360;
/** Waves are created when they come this far ahead of the squad, the same on every screen size. */
export const SPAWN_AHEAD = 660;
/** Enemies this far behind the squad are gone for good. */
export const DESPAWN_BEHIND = 190;
export const MAX_SQUAD = 200;
export const SOLDIER_R = 5;
export const SLOT_SPACING = 7.4;
/** In a boss arena the boss holds this far ahead of the squad. */
export const BOSS_AHEAD = 320;
/** Leader's top sideways speed, units/s. */
export const LEADER_SPEED = 520;

/** Physics layers. */
export const L_SQUAD = 1;
export const L_ENEMY = 2;
export const L_WALL = 4;
