import { cos, sin, sqrt } from './dmath';
import { SpatialHash } from './grid';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface WorldConfig {
  /** Global object cap. createBody refuses past this. Max 2^20. */
  capacity: number;
  /** Tether cap. addTether refuses past this. */
  tetherCapacity: number;
  /** Max contacts recorded per step. Extra contacts still resolve, they just aren't reported. */
  contactCapacity: number;
  /** Fixed timestep in seconds. Never changes during a run. */
  dt: number;
  gravityX: number;
  gravityY: number;
  /** 'linear' pulls along (gravityX, gravityY). 'point' pulls toward (gravityCx, gravityCy) with |gravity| strength. */
  gravityMode: 'linear' | 'point';
  gravityCx: number;
  gravityCy: number;
  /** Spatial grid cell size in world units. Roughly 2x a typical ball radius. */
  cellSize: number;
  /** Hard speed clamp, units/s. Keeps substep counts bounded. */
  maxSpeed: number;
  /** Max substeps per body per step against walls. */
  maxSubsteps: number;
  /** Impacts slower than this (approach speed) are resolved but not reported. */
  minImpactSpeed: number;
  /** Report bodies crossing other bodies' tethers. Costs a grid rebuild per step when tethers exist. */
  detectTetherTouch: boolean;
  /**
   * Fraction of body-body overlap removed per step. 1 = hard. Lower values let
   * dense crowds compress a little, so containers can fill to a near-solid mass.
   */
  pairCorrection: number;
  /** Impacts slower than this bounce with zero restitution, so piles settle instead of jittering. */
  restThreshold: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  capacity: 20000,
  tetherCapacity: 20000,
  contactCapacity: 20000,
  dt: 1 / 120,
  gravityX: 0,
  gravityY: 0,
  gravityMode: 'linear',
  gravityCx: 0,
  gravityCy: 0,
  cellSize: 24,
  maxSpeed: 6000,
  maxSubsteps: 32,
  minImpactSpeed: 1,
  detectTetherTouch: true,
  pairCorrection: 1,
  restThreshold: 0,
};

export interface BodyDef {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius: number;
  /** Defaults to radius^2 (area-proportional). */
  mass?: number;
  /** Immovable by collisions (still integrates its own velocity). */
  fixed?: boolean;
  /** 1 = perfectly elastic. Combined with the other side by multiplication. */
  restitution?: number;
  /** Linear drag per second. */
  damping?: number;
  /** Gravity multiplier. 0 ignores world gravity. */
  gravityScale?: number;
  /** Collision filtering: A and B collide when (A.layer & B.mask) && (B.layer & A.mask). */
  layer?: number;
  mask?: number;
  /** Free integer for the layer above (e.g. object group / team). */
  group?: number;
  /** 'box' is an axis-aligned square with half-size `radius`. It never rotates. */
  shape?: 'circle' | 'box';
}

export type PieceDef =
  | { kind: 'segment'; ax: number; ay: number; bx: number; by: number; halfThickness?: number }
  | {
      kind: 'arc';
      cx?: number;
      cy?: number;
      radius: number;
      /** Start angle (radians, CCW from +x in local space). */
      start: number;
      /** Angular length, (0, 2*PI]. */
      span: number;
      halfThickness?: number;
    };

export interface ColliderDef {
  x?: number;
  y?: number;
  angle?: number;
  angularVelocity?: number;
  /** Set when the collider's rotation will change later (motion). Keeps rotation free of grid rebuilds. */
  rotates?: boolean;
  vx?: number;
  vy?: number;
  restitution?: number;
  layer?: number;
  mask?: number;
  group?: number;
  pieces: PieceDef[];
}

export type TetherAnchor =
  | { kind: 'point'; x: number; y: number }
  /** World point that becomes fixed to the collider (rotates/moves with it). */
  | { kind: 'collider'; collider: number; x: number; y: number }
  | { kind: 'body'; body: number };

export interface TetherDef {
  body: number;
  anchor: TetherAnchor;
  /** Slack below this length. Defaults to the current distance. */
  restLength?: number;
  /** Spring stiffness per unit mass (1/s^2). 0 = visual only. Clamped for stability. */
  stiffness?: number;
  /** Damping along the tether, 1/s. */
  damping?: number;
  /** Hard maximum length (rope). Infinity = none. */
  maxLength?: number;
}

export const CONTACT_WALL = 0;
export const CONTACT_BODY = 1;
export const CONTACT_TETHER = 2;

/* ------------------------------------------------------------------ */
/* Handles                                                             */
/* ------------------------------------------------------------------ */

const IDX = 1048576; // 2^20
const handleOf = (gen: number, i: number) => gen * IDX + i;
const indexPart = (h: number) => h % IDX;
const genPart = (h: number) => Math.floor(h / IDX);

const PIECE_STRIDE = 12;
const SEG = 0;
const ARC = 1;

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export class World {
  readonly cfg: WorldConfig;
  time = 0;
  stepCount = 0;
  gravityX: number;
  gravityY: number;
  gravityMode: 'linear' | 'point';
  gravityCx: number;
  gravityCy: number;

  /* Bodies (SoA, indexed 0..highWater-1, check alive[]) */
  readonly cap: number;
  highWater = 0;
  aliveCount = 0;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly r: Float64Array;
  readonly invMass: Float64Array;
  readonly restitution: Float64Array;
  readonly damping: Float64Array;
  readonly gravityScale: Float64Array;
  readonly layer: Uint32Array;
  readonly mask: Uint32Array;
  readonly group: Int32Array;
  readonly gen: Uint32Array;
  readonly alive: Uint8Array;
  readonly tetherCount: Int32Array;
  /** 0 circle, 1 axis-aligned box (half-size r). */
  readonly shape: Uint8Array;
  /** Frozen bodies don't move or collide. Used to take bodies out of play temporarily. */
  readonly frozen: Uint8Array;
  /** Seconds of softness left: soft bodies push apart gently and don't bounce (for bodies placed into a crowd). */
  readonly soft: Float64Array;
  private freeList: Int32Array;
  private freeTop = 0;
  private bodyRange: Int32Array;
  private pairStamp: Int32Array;

  /* Colliders */
  colAlive: boolean[] = [];
  colX: number[] = [];
  colY: number[] = [];
  colAngle: number[] = [];
  colCos: number[] = [];
  colSin: number[] = [];
  colW: number[] = [];
  colRotates: boolean[] = [];
  /** Uniform scale of the collider's pieces (thickness stays fixed) and its rate of change per second. */
  colScale: number[] = [];
  colScaleVel: number[] = [];
  /** True when every piece is an arc centered on the collider origin (rings). Found by distance, not by grid. */
  colRadial: boolean[] = [];
  colRingR: number[] = [];
  /** Relative growth rate (dR/dt / R) used only for wall velocity, when pieces are resized by hand. */
  colGrowth: number[] = [];
  colVx: number[] = [];
  colVy: number[] = [];
  colRest: number[] = [];
  colLayer: number[] = [];
  colMask: number[] = [];
  colGroup: number[] = [];
  colPieceStart: number[] = [];
  colPieceCount: number[] = [];
  colBound: number[] = [];

  /* Pieces (flattened) */
  pieceCount = 0;
  pKind: number[] = [];
  pCol: number[] = [];
  pHt: number[] = [];
  pAlive: boolean[] = [];
  pData: number[] = [];
  private pStamp: number[] = [];
  private stamp = 0;
  private staticDirty = true;
  private minHalfThickness = 0;

  /* Tethers */
  readonly tetherCap: number;
  tetherHigh = 0;
  tetherAliveCount = 0;
  readonly tAlive: Uint8Array;
  readonly tGen: Uint32Array;
  readonly tBody: Int32Array;
  readonly tKind: Uint8Array; // 0 point, 1 collider, 2 body
  readonly tRef: Int32Array;
  readonly tLx: Float64Array;
  readonly tLy: Float64Array;
  readonly tRest: Float64Array;
  readonly tK: Float64Array;
  readonly tDamp: Float64Array;
  readonly tMax: Float64Array;
  private tFree: Int32Array;
  private tFreeTop = 0;
  private tStamp: Int32Array;

  /* Grids */
  readonly staticGrid: SpatialHash;
  readonly bodyGrid: SpatialHash;
  readonly tetherGrid: SpatialHash;

  /* Contacts reported by the last step */
  contactCount = 0;
  readonly cKind: Uint8Array;
  readonly cA: Int32Array; // body index
  readonly cB: Int32Array; // collider id | body index | tether owner index
  readonly cC: Int32Array; // piece index | -1 | tether index
  readonly cPx: Float64Array;
  readonly cPy: Float64Array;
  readonly cNx: Float64Array;
  readonly cNy: Float64Array;
  readonly cSpeed: Float64Array;

  /* Guard counters (cumulative) */
  readonly stats = { spawnRefused: 0, tetherRefused: 0, contactsDropped: 0, substepCapHits: 0 };

  constructor(config: Partial<WorldConfig> = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (cfg.capacity > IDX) throw new Error(`capacity max is ${IDX}`);
    this.cfg = cfg;
    this.gravityX = cfg.gravityX;
    this.gravityY = cfg.gravityY;
    this.gravityMode = cfg.gravityMode;
    this.gravityCx = cfg.gravityCx;
    this.gravityCy = cfg.gravityCy;

    const n = (this.cap = cfg.capacity);
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.r = new Float64Array(n);
    this.invMass = new Float64Array(n);
    this.restitution = new Float64Array(n);
    this.damping = new Float64Array(n);
    this.gravityScale = new Float64Array(n);
    this.layer = new Uint32Array(n);
    this.mask = new Uint32Array(n);
    this.group = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.alive = new Uint8Array(n);
    this.tetherCount = new Int32Array(n);
    this.shape = new Uint8Array(n);
    this.frozen = new Uint8Array(n);
    this.soft = new Float64Array(n);
    this.freeList = new Int32Array(n);
    this.bodyRange = new Int32Array(n * 4);
    this.pairStamp = new Int32Array(n);

    const t = (this.tetherCap = cfg.tetherCapacity);
    this.tAlive = new Uint8Array(t);
    this.tGen = new Uint32Array(t);
    this.tBody = new Int32Array(t);
    this.tKind = new Uint8Array(t);
    this.tRef = new Int32Array(t);
    this.tLx = new Float64Array(t);
    this.tLy = new Float64Array(t);
    this.tRest = new Float64Array(t);
    this.tK = new Float64Array(t);
    this.tDamp = new Float64Array(t);
    this.tMax = new Float64Array(t);
    this.tFree = new Int32Array(t);
    this.tStamp = new Int32Array(t);

    const c = cfg.contactCapacity;
    this.cKind = new Uint8Array(c);
    this.cA = new Int32Array(c);
    this.cB = new Int32Array(c);
    this.cC = new Int32Array(c);
    this.cPx = new Float64Array(c);
    this.cPy = new Float64Array(c);
    this.cNx = new Float64Array(c);
    this.cNy = new Float64Array(c);
    this.cSpeed = new Float64Array(c);

    this.staticGrid = new SpatialHash(cfg.cellSize, 14);
    this.bodyGrid = new SpatialHash(cfg.cellSize, 15);
    this.tetherGrid = new SpatialHash(cfg.cellSize * 2, 14);
  }

  /* ---------------------------- Bodies ---------------------------- */

  /** Returns a handle, or -1 if the object cap is reached. */
  createBody(d: BodyDef): number {
    let i: number;
    if (this.freeTop > 0) i = this.freeList[--this.freeTop];
    else if (this.highWater < this.cap) i = this.highWater++;
    else {
      this.stats.spawnRefused++;
      return -1;
    }
    this.x[i] = d.x;
    this.y[i] = d.y;
    this.vx[i] = d.vx ?? 0;
    this.vy[i] = d.vy ?? 0;
    this.r[i] = d.radius;
    this.invMass[i] = d.fixed ? 0 : 1 / (d.mass ?? d.radius * d.radius);
    this.restitution[i] = d.restitution ?? 1;
    this.damping[i] = d.damping ?? 0;
    this.gravityScale[i] = d.gravityScale ?? 1;
    this.layer[i] = (d.layer ?? 1) >>> 0;
    this.mask[i] = (d.mask ?? 0xffffffff) >>> 0;
    this.group[i] = d.group ?? 0;
    this.tetherCount[i] = 0;
    this.shape[i] = d.shape === 'box' ? 1 : 0;
    this.frozen[i] = 0;
    this.soft[i] = 0;
    this.alive[i] = 1;
    this.aliveCount++;
    return handleOf(this.gen[i], i);
  }

  /** Index for a live handle, else -1. */
  indexOf(h: number): number {
    if (h < 0) return -1;
    const i = indexPart(h);
    return i < this.highWater && this.alive[i] && this.gen[i] === genPart(h) ? i : -1;
  }

  handleAt(i: number): number {
    return handleOf(this.gen[i], i);
  }

  isAlive(h: number): boolean {
    return this.indexOf(h) >= 0;
  }

  /** Destroys a body and every tether attached to it. Call between steps. */
  destroyBody(h: number): boolean {
    const i = this.indexOf(h);
    if (i < 0) return false;
    this.destroyIndex(i);
    return true;
  }

  destroyIndex(i: number): void {
    if (!this.alive[i]) return;
    if (this.tetherCount[i] > 0 || this.tetherAliveCount > 0) {
      for (let t = 0; t < this.tetherHigh; t++) {
        if (this.tAlive[t] && (this.tBody[t] === i || (this.tKind[t] === 2 && this.tRef[t] === i))) {
          this.removeTetherIndex(t);
        }
      }
    }
    this.alive[i] = 0;
    this.gen[i] = (this.gen[i] + 1) >>> 0;
    this.freeList[this.freeTop++] = i;
    this.aliveCount--;
  }

  /* --------------------------- Colliders -------------------------- */

  addCollider(d: ColliderDef): number {
    const id = this.colAlive.length;
    const angle = d.angle ?? 0;
    this.colAlive.push(true);
    this.colX.push(d.x ?? 0);
    this.colY.push(d.y ?? 0);
    this.colAngle.push(angle);
    this.colCos.push(cos(angle));
    this.colSin.push(sin(angle));
    this.colW.push(d.angularVelocity ?? 0);
    this.colRotates.push(!!d.rotates || (d.angularVelocity ?? 0) !== 0);
    this.colScale.push(1);
    this.colScaleVel.push(0);
    const radial = d.pieces.length > 0 && d.pieces.every((pc) => pc.kind === 'arc' && !(pc.cx ?? 0) && !(pc.cy ?? 0) && pc.radius === (d.pieces[0] as { radius: number }).radius);
    this.colRadial.push(radial);
    this.colRingR.push(radial ? (d.pieces[0] as { radius: number }).radius : 0);
    this.colGrowth.push(0);
    this.colVx.push(d.vx ?? 0);
    this.colVy.push(d.vy ?? 0);
    this.colRest.push(d.restitution ?? 1);
    this.colLayer.push((d.layer ?? 1) >>> 0);
    this.colMask.push((d.mask ?? 0xffffffff) >>> 0);
    this.colGroup.push(d.group ?? 0);
    this.colPieceStart.push(this.pieceCount);
    this.colPieceCount.push(d.pieces.length);
    let bound = 0;
    for (const p of d.pieces) bound = Math.max(bound, this.pushPiece(id, p));
    this.colBound.push(bound);
    this.staticDirty = true;
    this.radialDirty = true;
    return id;
  }

  private pushPiece(col: number, p: PieceDef): number {
    const ht = p.halfThickness ?? 1;
    const base = this.pieceCount * PIECE_STRIDE;
    for (let k = 0; k < PIECE_STRIDE; k++) this.pData[base + k] = 0;
    const D = this.pData;
    let bound: number;
    if (p.kind === 'segment') {
      this.pKind.push(SEG);
      D[base] = p.ax; D[base + 1] = p.ay; D[base + 2] = p.bx; D[base + 3] = p.by;
      const ex = p.bx - p.ax, ey = p.by - p.ay;
      const len = sqrt(ex * ex + ey * ey);
      D[base + 4] = len > 0 ? -ey / len : 0;
      D[base + 5] = len > 0 ? ex / len : 1;
      D[base + 6] = ex * ex + ey * ey;
      bound = Math.max(sqrt(p.ax * p.ax + p.ay * p.ay), sqrt(p.bx * p.bx + p.by * p.by)) + ht;
    } else {
      this.pKind.push(ARC);
      const cx = p.cx ?? 0, cy = p.cy ?? 0;
      const span = Math.min(p.span, 6.283185307179586);
      const end = p.start + span;
      const u0x = cos(p.start), u0y = sin(p.start);
      const u1x = cos(end), u1y = sin(end);
      D[base] = cx; D[base + 1] = cy; D[base + 2] = p.radius; D[base + 3] = span;
      D[base + 4] = u0x; D[base + 5] = u0y; D[base + 6] = u1x; D[base + 7] = u1y;
      D[base + 8] = cx + u0x * p.radius; D[base + 9] = cy + u0y * p.radius;
      D[base + 10] = cx + u1x * p.radius; D[base + 11] = cy + u1y * p.radius;
      bound = sqrt(cx * cx + cy * cy) + p.radius + ht;
    }
    this.pCol.push(col);
    this.pHt.push(ht);
    this.pAlive.push(true);
    this.pStamp.push(0);
    this.pieceCount++;
    return bound;
  }

  removeCollider(id: number): void {
    if (!this.colAlive[id]) return;
    this.colAlive[id] = false;
    const s = this.colPieceStart[id];
    for (let p = s; p < s + this.colPieceCount[id]; p++) this.pAlive[p] = false;
    for (let t = 0; t < this.tetherHigh; t++) {
      if (this.tAlive[t] && this.tKind[t] === 1 && this.tRef[t] === id) this.removeTetherIndex(t);
    }
    this.staticDirty = true;
    this.radialDirty = true;
  }

  setColliderTransform(id: number, x: number, y: number, angle: number): void {
    this.colX[id] = x;
    this.colY[id] = y;
    this.colAngle[id] = angle;
    this.colCos[id] = cos(angle);
    this.colSin[id] = sin(angle);
    this.staticDirty = true;
    this.radialDirty = true;
  }

  /**
   * Reshape an arc piece in place (radius, start, span). For rings that change
   * size while keeping their gaps a fixed width. Set `growth` (dR/dt / R) so
   * bounces feel the moving wall.
   */
  setArc(p: number, radius: number, start: number, span: number, growth = 0): void {
    const D = this.pData, b = p * PIECE_STRIDE;
    const cx = D[b], cy = D[b + 1];
    span = Math.min(span, 6.283185307179586);
    const end = start + span;
    const u0x = cos(start), u0y = sin(start), u1x = cos(end), u1y = sin(end);
    D[b + 2] = radius; D[b + 3] = span;
    D[b + 4] = u0x; D[b + 5] = u0y; D[b + 6] = u1x; D[b + 7] = u1y;
    D[b + 8] = cx + u0x * radius; D[b + 9] = cy + u0y * radius;
    D[b + 10] = cx + u1x * radius; D[b + 11] = cy + u1y * radius;
    const col = this.pCol[p];
    if (this.colRadial[col]) { if (this.colRingR[col] !== radius) this.radialDirty = true; this.colRingR[col] = radius; }
    this.colGrowth[col] = growth;
    if (!this.colRadial[col]) this.staticDirty = true;
  }

  /** Scale a collider's pieces around its origin. Thickness is unchanged. `scaleVelocity` is per second. */
  setColliderScale(id: number, scale: number, scaleVelocity = 0): void {
    this.colScale[id] = scale;
    this.colScaleVel[id] = scaleVelocity;
    this.staticDirty = true;
    this.radialDirty = true;
  }

  setColliderVelocity(id: number, vx: number, vy: number, angularVelocity: number): void {
    this.colVx[id] = vx;
    this.colVy[id] = vy;
    if (angularVelocity !== 0 && !this.colRotates[id]) {
      this.colRotates[id] = true;
      this.staticDirty = true;
    }
    if (vx !== 0 || vy !== 0) this.staticDirty = true;
    if ((vx !== 0 || vy !== 0) !== (this.colVx[id] !== 0 || this.colVy[id] !== 0)) this.radialDirty = true;
    this.colW[id] = angularVelocity;
  }

  /** World position of a collider-local point. */
  colliderToWorld(id: number, lx: number, ly: number, out: { x: number; y: number }): void {
    const c = this.colCos[id], s = this.colSin[id];
    out.x = this.colX[id] + c * lx - s * ly;
    out.y = this.colY[id] + s * lx + c * ly;
  }

  private rebuildStatic(): void {
    const g = this.staticGrid;
    g.begin();
    let minHt = Infinity;
    for (let p = 0; p < this.pieceCount; p++) {
      if (!this.pAlive[p]) continue;
      const col = this.pCol[p];
      const ht = this.pHt[p];
      if (ht < minHt) minHt = ht;
      if (this.colRadial[col]) continue;
      const sc = this.colScale[col];
      if (this.colRotates[col]) {
        // Rotating: register the rotation-invariant bound so rotation never forces a rebuild.
        const b = this.colBound[col] * Math.max(1, sc);
        g.add(p, this.colX[col] - b, this.colY[col] - b, this.colX[col] + b, this.colY[col] + b);
        continue;
      }
      const D = this.pData, base = p * PIECE_STRIDE;
      let x0: number, y0: number, x1: number, y1: number;
      if (this.pKind[p] === SEG) {
        x0 = Math.min(D[base], D[base + 2]) * sc - ht; x1 = Math.max(D[base], D[base + 2]) * sc + ht;
        y0 = Math.min(D[base + 1], D[base + 3]) * sc - ht; y1 = Math.max(D[base + 1], D[base + 3]) * sc + ht;
      } else {
        const R = D[base + 2] * sc + ht;
        x0 = D[base] * sc - R; x1 = D[base] * sc + R; y0 = D[base + 1] * sc - R; y1 = D[base + 1] * sc + R;
      }
      // Rotate the local AABB corners into world space.
      const c = this.colCos[col], s = this.colSin[col], ox = this.colX[col], oy = this.colY[col];
      let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const lx = k & 1 ? x1 : x0, ly = k & 2 ? y1 : y0;
        const wx = ox + c * lx - s * ly, wy = oy + s * lx + c * ly;
        if (wx < wx0) wx0 = wx; if (wx > wx1) wx1 = wx;
        if (wy < wy0) wy0 = wy; if (wy > wy1) wy1 = wy;
      }
      g.add(p, wx0, wy0, wx1, wy1);
    }
    g.build();
    this.minHalfThickness = minHt === Infinity ? 0 : minHt;
    this.staticDirty = false;
  }

  /* Radial colliders (rings): still, unscaled rings that share a center form a
   * stack sorted by radius, searched by distance from the center. Everything
   * else radial (moving or scaling rings) is checked one by one. */
  private radialDirty = true;
  private stacks: { cx: number; cy: number; R: Float64Array; cols: Int32Array }[] = [];
  private looseRadial: number[] = [];
  private radialMaxHt = 0;
  private hasRadial = false;

  private rebuildRadial(): void {
    const groups = new Map<string, { cx: number; cy: number; items: [number, number][] }>();
    this.looseRadial = [];
    let maxHt = 0;
    let any = false;
    for (let c = 0; c < this.colAlive.length; c++) {
      if (!this.colAlive[c] || !this.colRadial[c]) continue;
      any = true;
      for (let p = this.colPieceStart[c]; p < this.colPieceStart[c] + this.colPieceCount[c]; p++) if (this.pHt[p] > maxHt) maxHt = this.pHt[p];
      const still = this.colVx[c] === 0 && this.colVy[c] === 0 && this.colScale[c] === 1 && this.colScaleVel[c] === 0;
      if (!still) { this.looseRadial.push(c); continue; }
      const key = `${this.colX[c]},${this.colY[c]}`;
      let gr = groups.get(key);
      if (!gr) { gr = { cx: this.colX[c], cy: this.colY[c], items: [] }; groups.set(key, gr); }
      gr.items.push([this.colRingR[c], c]);
    }
    this.stacks = [];
    for (const gr of groups.values()) {
      gr.items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      this.stacks.push({ cx: gr.cx, cy: gr.cy, R: Float64Array.from(gr.items.map((x) => x[0])), cols: Int32Array.from(gr.items.map((x) => x[1])) });
    }
    this.radialMaxHt = maxHt;
    this.hasRadial = any;
    this.radialDirty = false;
  }

  /* ---------------------------- Tethers --------------------------- */

  /** Returns a tether handle, or -1 if the tether cap is reached or the body is dead. */
  addTether(d: TetherDef): number {
    const bi = this.indexOf(d.body);
    if (bi < 0) return -1;
    let t: number;
    if (this.tFreeTop > 0) t = this.tFree[--this.tFreeTop];
    else if (this.tetherHigh < this.tetherCap) t = this.tetherHigh++;
    else {
      this.stats.tetherRefused++;
      return -1;
    }
    const a = d.anchor;
    let ax: number, ay: number;
    if (a.kind === 'point') {
      this.tKind[t] = 0; this.tRef[t] = -1; this.tLx[t] = a.x; this.tLy[t] = a.y;
      ax = a.x; ay = a.y;
    } else if (a.kind === 'collider') {
      const id = a.collider;
      if (!this.colAlive[id]) { this.tFree[this.tFreeTop++] = t; return -1; }
      const dx = a.x - this.colX[id], dy = a.y - this.colY[id];
      const c = this.colCos[id], s = this.colSin[id];
      this.tKind[t] = 1; this.tRef[t] = id;
      this.tLx[t] = c * dx + s * dy; this.tLy[t] = -s * dx + c * dy;
      ax = a.x; ay = a.y;
    } else {
      const oi = this.indexOf(a.body);
      if (oi < 0 || oi === bi) { this.tFree[this.tFreeTop++] = t; return -1; }
      this.tKind[t] = 2; this.tRef[t] = oi; this.tLx[t] = 0; this.tLy[t] = 0;
      ax = this.x[oi]; ay = this.y[oi];
      this.tetherCount[oi]++;
    }
    const dx = ax - this.x[bi], dy = ay - this.y[bi];
    this.tBody[t] = bi;
    this.tRest[t] = d.restLength ?? sqrt(dx * dx + dy * dy);
    this.tK[t] = d.stiffness ?? 0;
    this.tDamp[t] = d.damping ?? 0;
    this.tMax[t] = d.maxLength ?? Infinity;
    this.tAlive[t] = 1;
    this.tetherCount[bi]++;
    this.tetherAliveCount++;
    return handleOf(this.tGen[t], t);
  }

  tetherIndexOf(h: number): number {
    if (h < 0) return -1;
    const t = indexPart(h);
    return t < this.tetherHigh && this.tAlive[t] && this.tGen[t] === genPart(h) ? t : -1;
  }

  tetherHandleAt(t: number): number {
    return handleOf(this.tGen[t], t);
  }

  removeTether(h: number): boolean {
    const t = this.tetherIndexOf(h);
    if (t < 0) return false;
    this.removeTetherIndex(t);
    return true;
  }

  removeTetherIndex(t: number): void {
    if (!this.tAlive[t]) return;
    this.tAlive[t] = 0;
    this.tGen[t] = (this.tGen[t] + 1) >>> 0;
    this.tetherCount[this.tBody[t]]--;
    if (this.tKind[t] === 2) this.tetherCount[this.tRef[t]]--;
    this.tFree[this.tFreeTop++] = t;
    this.tetherAliveCount--;
  }

  /** Current world-space anchor of tether t. */
  tetherAnchor(t: number, out: { x: number; y: number }): void {
    const k = this.tKind[t];
    if (k === 0) { out.x = this.tLx[t]; out.y = this.tLy[t]; }
    else if (k === 1) this.colliderToWorld(this.tRef[t], this.tLx[t], this.tLy[t], out);
    else { out.x = this.x[this.tRef[t]]; out.y = this.y[this.tRef[t]]; }
  }

  /* ----------------------------- Step ----------------------------- */

  step(): void {
    const dt = this.cfg.dt;
    this.contactCount = 0;

    this.advanceColliders(dt);
    if (this.staticDirty) this.rebuildStatic();
    if (this.radialDirty) this.rebuildRadial();
    if (this.tetherAliveCount > 0) this.applyTethers(dt);
    this.integrate(dt);
    this.solveBodyPairs();
    // Walls get the last word, so crowds can't push bodies through them.
    if (this.staticGrid.entryCount > 0 || this.hasRadial) {
      for (let i = 0; i < this.highWater; i++) {
        if (this.alive[i] && !this.frozen[i]) this.resolveStatic(i, false);
      }
    }
    if (this.cfg.detectTetherTouch && this.tetherAliveCount > 0) this.detectTetherTouches();

    this.stepCount++;
    this.time = this.stepCount * dt;
  }

  private advanceColliders(dt: number): void {
    for (let id = 0; id < this.colAlive.length; id++) {
      if (!this.colAlive[id]) continue;
      const w = this.colW[id];
      if (w !== 0) {
        const a = this.colAngle[id] + w * dt;
        this.colAngle[id] = a;
        this.colCos[id] = cos(a);
        this.colSin[id] = sin(a);
      }
      if (this.colVx[id] !== 0 || this.colVy[id] !== 0) {
        this.colX[id] += this.colVx[id] * dt;
        this.colY[id] += this.colVy[id] * dt;
        if (!this.colRadial[id]) this.staticDirty = true;
      }
      const sv = this.colScaleVel[id];
      if (sv !== 0) {
        const ns = Math.max(0.001, this.colScale[id] + sv * dt);
        if (!this.colRadial[id] && ns > this.colScale[id]) this.staticDirty = true;
        this.colScale[id] = ns;
      }
    }
  }

  private readonly tmp = { x: 0, y: 0 };

  private applyTethers(dt: number): void {
    const P = this.tmp;
    for (let t = 0; t < this.tetherHigh; t++) {
      if (!this.tAlive[t]) continue;
      const i = this.tBody[t];
      this.tetherAnchor(t, P);
      const dx = P.x - this.x[i], dy = P.y - this.y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 === 0) continue;
      const d = sqrt(d2);
      const ux = dx / d, uy = dy / d;
      const other = this.tKind[t] === 2 ? this.tRef[t] : -1;
      const wi = this.invMass[i];
      const wj = other >= 0 ? this.invMass[other] : 0;

      // Spring (slack below rest length). Stiffness is per unit mass; clamp keeps explicit Euler stable.
      const stretch = d - this.tRest[t];
      if (stretch > 0 && (this.tK[t] > 0 || this.tDamp[t] > 0)) {
        const n = Math.max(1, this.tetherCount[i]);
        const kMax = 0.25 / (dt * dt * n);
        const k = Math.min(this.tK[t], kMax);
        let avx = 0, avy = 0;
        if (other >= 0) { avx = this.vx[other]; avy = this.vy[other]; }
        else if (this.tKind[t] === 1) {
          const id = this.tRef[t], w = this.colW[id];
          avx = this.colVx[id] - w * (P.y - this.colY[id]);
          avy = this.colVy[id] + w * (P.x - this.colX[id]);
        }
        const relV = (avx - this.vx[i]) * ux + (avy - this.vy[i]) * uy;
        const c = Math.min(this.tDamp[t], 0.5 / dt);
        const a = (k * stretch + c * relV) * dt; // delta-v along u
        if (wi > 0) { this.vx[i] += ux * a; this.vy[i] += uy * a; }
        if (wj > 0) { this.vx[other] -= ux * a; this.vy[other] -= uy * a; }
      }

      // Hard max length (rope).
      const over = d - this.tMax[t];
      if (over > 0) {
        const ws = wi + wj;
        if (ws > 0) {
          const fi = wi / ws, fj = wj / ws;
          this.x[i] += ux * over * fi; this.y[i] += uy * over * fi;
          const vn = this.vx[i] * ux + this.vy[i] * uy;
          if (vn < 0) { this.vx[i] -= ux * vn; this.vy[i] -= uy * vn; }
          if (other >= 0 && fj > 0) {
            this.x[other] -= ux * over * fj; this.y[other] -= uy * over * fj;
            const vo = this.vx[other] * ux + this.vy[other] * uy;
            if (vo > 0) { this.vx[other] -= ux * vo; this.vy[other] -= uy * vo; }
          }
        }
      }
    }
  }

  private integrate(dt: number): void {
    const cfg = this.cfg;
    const max = cfg.maxSpeed, max2 = max * max;
    let gx = this.gravityX, gy = this.gravityY;
    const radial = this.gravityMode === 'point';
    const gStrength = radial ? sqrt(gx * gx + gy * gy) : 0;
    const hasStatic = this.staticGrid.entryCount > 0 || this.hasRadial;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i] || this.frozen[i]) continue;
      if (this.soft[i] > 0) this.soft[i] = Math.max(0, this.soft[i] - dt);
      if (radial) {
        const dx = this.gravityCx - this.x[i], dy = this.gravityCy - this.y[i];
        const d = sqrt(dx * dx + dy * dy);
        if (d > 1e-9) { gx = (dx / d) * gStrength; gy = (dy / d) * gStrength; } else { gx = 0; gy = 0; }
      }
      let vx = this.vx[i] + gx * this.gravityScale[i] * dt;
      let vy = this.vy[i] + gy * this.gravityScale[i] * dt;
      const dmp = this.damping[i];
      if (dmp > 0) {
        const f = 1 / (1 + dmp * dt);
        vx *= f; vy *= f;
      }
      const s2 = vx * vx + vy * vy;
      let speed = sqrt(s2);
      if (s2 > max2) {
        const k = max / speed;
        vx *= k; vy *= k; speed = max;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;

      if (!hasStatic) {
        this.x[i] += vx * dt;
        this.y[i] += vy * dt;
        continue;
      }
      // Substep so a body never moves more than half its contact radius per substep.
      const safe = 0.5 * (this.r[i] + this.minHalfThickness);
      let n = safe > 0 ? Math.ceil((speed * dt) / safe) : 1;
      if (n < 1) n = 1;
      if (n > cfg.maxSubsteps) { n = cfg.maxSubsteps; this.stats.substepCapHits++; }
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
        this.resolveStatic(i, true);
      }
    }
  }

  private reportedCols: number[] = [-1, -1, -1, -1];

  private candP: number[] = [];
  private candD: number[] = [];
  private candOrder: number[] = [];
  private lastDepth = 0;

  /**
   * Resolves body i against every overlapping wall piece, deepest first.
   * Deepest-first matters at polyline joints: the face of one segment is always
   * deeper than the shared endpoint cap of its neighbor, and resolving the face
   * first removes the cap contact, so fast balls don't get skewed normals.
   */
  private resolveStatic(i: number, report: boolean): void {
    const g = this.staticGrid;
    const r = this.r[i];
    const x0 = g.cellOf(this.x[i] - r), x1 = g.cellOf(this.x[i] + r);
    const y0 = g.cellOf(this.y[i] - r), y1 = g.cellOf(this.y[i] + r);
    const stamp = ++this.stamp;
    const P = this.candP, Dp = this.candD;
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const hi = g.bucketHi(cx, cy);
        for (let e = g.bucketLo(cx, cy); e < hi; e++) {
          if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
          const p = g.entryItem[e];
          if (this.pStamp[p] === stamp) continue;
          this.pStamp[p] = stamp;
          if (this.collidePiece(i, p, true) >= 0) { P[n] = p; Dp[n] = this.lastDepth; n++; }
        }
      }
    }
    if (this.hasRadial) {
      const reach = (this.shape[i] === 1 ? r * 1.4143 : r) + this.radialMaxHt + 1;
      const bx = this.x[i], by = this.y[i];
      for (const st of this.stacks) {
        const d = sqrt((bx - st.cx) * (bx - st.cx) + (by - st.cy) * (by - st.cy));
        // Binary search for the first ring with R >= d - reach.
        let lo = 0, hi = st.R.length;
        const want = d - reach;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (st.R[mid] < want) lo = mid + 1; else hi = mid; }
        for (let k = lo; k < st.R.length && st.R[k] <= d + reach; k++) {
          const c = st.cols[k];
          for (let p = this.colPieceStart[c]; p < this.colPieceStart[c] + this.colPieceCount[c]; p++) {
            if (this.pAlive[p] && this.collidePiece(i, p, true) >= 0) { P[n] = p; Dp[n] = this.lastDepth; n++; }
          }
        }
      }
      for (const c of this.looseRadial) {
        const d = sqrt((bx - this.colX[c]) ** 2 + (by - this.colY[c]) ** 2);
        if (Math.abs(d - this.colRingR[c] * this.colScale[c]) > reach) continue;
        for (let p = this.colPieceStart[c]; p < this.colPieceStart[c] + this.colPieceCount[c]; p++) {
          if (this.pAlive[p] && this.collidePiece(i, p, true) >= 0) { P[n] = p; Dp[n] = this.lastDepth; n++; }
        }
      }
    }
    if (n === 0) return;
    const rep = this.reportedCols;
    rep[0] = rep[1] = rep[2] = rep[3] = -1;
    let nRep = 0;
    const order = this.candOrder;
    order.length = n;
    for (let k = 0; k < n; k++) order[k] = k;
    if (n > 1) order.sort((a, b) => Dp[b] - Dp[a] || P[a] - P[b]);
    for (let k = 0; k < n; k++) {
      const p = P[order[k]];
      const col = this.collidePiece(i, p, false);
      if (col >= 0 && report) {
        let seen = false;
        for (let q = 0; q < nRep; q++) if (rep[q] === col) seen = true;
        if (!seen) {
          if (nRep < 4) rep[nRep++] = col;
          this.pushContact(CONTACT_WALL, i, col, p, this.hitPx, this.hitPy, this.hitNx, this.hitNy, this.hitSpeed);
        }
      }
    }
  }

  private hitPx = 0; private hitPy = 0; private hitNx = 0; private hitNy = 0; private hitSpeed = 0;

  /**
   * Resolves body i against piece p. Returns collider id if a reportable impact happened, else -1.
   * With `measure`, only tests overlap: returns 1 and sets lastDepth, or -1.
   */
  private collidePiece(i: number, p: number, measure: boolean): number {
    const col = this.pCol[p];
    if (!(this.layer[i] & this.colMask[col]) || !(this.colLayer[col] & this.mask[i])) return -1;
    const c = this.colCos[col], s = this.colSin[col];
    const ox = this.colX[col], oy = this.colY[col];
    const sc = this.colScale[col];
    const dx = this.x[i] - ox, dy = this.y[i] - oy;
    const lx = c * dx + s * dy, ly = -s * dx + c * dy;
    const D = this.pData, b = p * PIECE_STRIDE;
    const ht = this.pHt[p];
    let nlx: number, nly: number, pen: number;

    if (this.shape[i] === 1 && this.pKind[p] === SEG) {
      // Box vs thick segment, separating axis test on the segment normal and the box axes.
      const h = this.r[i];
      const ax = D[b] * sc, ay = D[b + 1] * sc, bx = D[b + 2] * sc, by = D[b + 3] * sc;
      const snx = D[b + 4], sny = D[b + 5];
      let best = Infinity, bnx = 0, bny = 0;
      for (let k = 0; k < 3; k++) {
        // Box axes expressed in the collider's local frame.
        const nx = k === 0 ? snx : k === 1 ? c : s;
        const ny = k === 0 ? sny : k === 1 ? -s : c;
        const boxC = lx * nx + ly * ny;
        const boxR = h * (Math.abs(nx * c - ny * s) + Math.abs(nx * s + ny * c));
        const pa = ax * nx + ay * ny, pb = bx * nx + by * ny;
        const extra = ht * Math.abs(nx * snx + ny * sny);
        const smin = Math.min(pa, pb) - extra, smax = Math.max(pa, pb) + extra;
        const overlap = Math.min(boxC + boxR, smax) - Math.max(boxC - boxR, smin);
        if (overlap <= 0) return -1;
        if (overlap < best) {
          best = overlap;
          const sign = boxC >= (smin + smax) / 2 ? 1 : -1;
          bnx = nx * sign; bny = ny * sign;
        }
      }
      if (measure) { this.lastDepth = best; return 1; }
      nlx = bnx; nly = bny; pen = best;
    } else {
      let qx: number, qy: number, fnx: number, fny: number;
      if (this.pKind[p] === SEG) {
        const ax = D[b] * sc, ay = D[b + 1] * sc, ex = (D[b + 2] - D[b]) * sc, ey = (D[b + 3] - D[b + 1]) * sc;
        const L2 = D[b + 6] * sc * sc;
        let t = L2 > 0 ? ((lx - ax) * ex + (ly - ay) * ey) / L2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        qx = ax + ex * t; qy = ay + ey * t;
        fnx = D[b + 4]; fny = D[b + 5];
      } else {
        const acx = D[b] * sc, acy = D[b + 1] * sc, R = D[b + 2] * sc, span = D[b + 3];
        const vx = lx - acx, vy = ly - acy;
        const len = sqrt(vx * vx + vy * vy);
        const reach = this.r[i] + ht;
        if (len - R > reach || R - len > reach) return -1;
        let inside: boolean;
        if (span >= 6.283185307179586) inside = true;
        else {
          const u0x = D[b + 4], u0y = D[b + 5], u1x = D[b + 6], u1y = D[b + 7];
          const c0 = u0x * vy - u0y * vx;
          const c1 = vx * u1y - vy * u1x;
          inside = span <= 3.141592653589793 ? c0 >= 0 && c1 >= 0 : !(c0 < 0 && c1 < 0);
        }
        if (inside && len > 0) {
          qx = acx + (vx / len) * R; qy = acy + (vy / len) * R;
          fnx = vx / len; fny = vy / len;
        } else {
          const e0x = D[b + 8] * sc, e0y = D[b + 9] * sc, e1x = D[b + 10] * sc, e1y = D[b + 11] * sc;
          const d0 = (lx - e0x) * (lx - e0x) + (ly - e0y) * (ly - e0y);
          const d1 = (lx - e1x) * (lx - e1x) + (ly - e1y) * (ly - e1y);
          if (d0 <= d1) { qx = e0x; qy = e0y; } else { qx = e1x; qy = e1y; }
          fnx = 1; fny = 0;
        }
      }
      const ex = lx - qx, ey = ly - qy;
      const R = this.r[i] + ht;
      const d2 = ex * ex + ey * ey;
      if (d2 >= R * R) return -1;
      const d = sqrt(d2);
      if (measure) { this.lastDepth = R - d; return 1; }
      if (d > 1e-12) { nlx = ex / d; nly = ey / d; } else { nlx = fnx; nly = fny; }
      pen = R - d;
    }

    const nx = c * nlx - s * nly, ny = s * nlx + c * nly;
    this.x[i] += nx * pen;
    this.y[i] += ny * pen;

    // Contact point in world space and wall velocity there (spin, slide and scaling).
    const px = this.x[i] - nx * this.r[i], py = this.y[i] - ny * this.r[i];
    const w = this.colW[col];
    const sv = (sc > 0 ? this.colScaleVel[col] / sc : 0) + this.colGrowth[col];
    const wvx = this.colVx[col] - w * (py - oy) + sv * (px - ox);
    const wvy = this.colVy[col] + w * (px - ox) + sv * (py - oy);
    const rvx = this.vx[i] - wvx, rvy = this.vy[i] - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return -1;
    let e = this.restitution[i] * this.colRest[col];
    if (-vn < this.cfg.restThreshold || this.soft[i] > 0) e = 0;
    const j = -(1 + e) * vn;
    this.vx[i] += nx * j;
    this.vy[i] += ny * j;
    if (-vn < this.cfg.minImpactSpeed) return -1;
    this.hitPx = px; this.hitPy = py; this.hitNx = nx; this.hitNy = ny; this.hitSpeed = -vn;
    return col;
  }

  private solveBodyPairs(): void {
    if (this.aliveCount < 2) return;
    const g = this.bodyGrid;
    g.begin();
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i] || this.frozen[i]) continue;
      const r = this.r[i];
      g.add(i, this.x[i] - r, this.y[i] - r, this.x[i] + r, this.y[i] + r);
    }
    g.build();
    const BR = this.bodyRange;
    {
      let k = 0;
      const tmp = [0, 0, 0, 0];
      for (let i = 0; i < this.highWater; i++) {
        if (!this.alive[i] || this.frozen[i]) continue;
        g.rangeOf(k++, tmp);
        BR[i * 4] = tmp[0]; BR[i * 4 + 1] = tmp[1]; BR[i * 4 + 2] = tmp[2]; BR[i * 4 + 3] = tmp[3];
      }
    }
    const minImpact = this.cfg.minImpactSpeed;
    const corr = this.cfg.pairCorrection;
    const restT = this.cfg.restThreshold;
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i] || this.frozen[i]) continue;
      const ix0 = BR[i * 4], iy0 = BR[i * 4 + 1], ix1 = BR[i * 4 + 2], iy1 = BR[i * 4 + 3];
      for (let cy = iy0; cy <= iy1; cy++) {
        for (let cx = ix0; cx <= ix1; cx++) {
          const hi = g.bucketHi(cx, cy);
          for (let e = g.bucketLo(cx, cy); e < hi; e++) {
            if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
            const j = g.entryItem[e];
            if (j <= i) continue;
            // Each overlapping pair is handled only in the first cell both cover.
            const ccx = ix0 > BR[j * 4] ? ix0 : BR[j * 4];
            const ccy = iy0 > BR[j * 4 + 1] ? iy0 : BR[j * 4 + 1];
            if (ccx !== cx || ccy !== cy) continue;
            if (!(this.layer[i] & this.mask[j]) || !(this.layer[j] & this.mask[i])) continue;
            const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
            let nx = 1, ny = 0, pen: number;
            const si = this.shape[i], sj = this.shape[j];
            if (si === 0 && sj === 0) {
              const R = this.r[i] + this.r[j];
              const d2 = dx * dx + dy * dy;
              if (d2 >= R * R) continue;
              const d = sqrt(d2);
              if (d > 1e-12) { nx = dx / d; ny = dy / d; }
              pen = R - d;
            } else if (si === 1 && sj === 1) {
              const ovx = this.r[i] + this.r[j] - Math.abs(dx);
              const ovy = this.r[i] + this.r[j] - Math.abs(dy);
              if (ovx <= 0 || ovy <= 0) continue;
              if (ovx < ovy) { nx = dx >= 0 ? 1 : -1; ny = 0; pen = ovx; }
              else { nx = 0; ny = dy >= 0 ? 1 : -1; pen = ovy; }
            } else {
              // Box vs circle. Work from the box's point of view, then flip if i is the circle.
              const bi = si === 1 ? i : j, ci = si === 1 ? j : i;
              const h = this.r[bi], rc = this.r[ci];
              const rx = this.x[ci] - this.x[bi], ry = this.y[ci] - this.y[bi];
              const qx = rx < -h ? -h : rx > h ? h : rx;
              const qy = ry < -h ? -h : ry > h ? h : ry;
              let mx: number, my: number;
              if (qx === rx && qy === ry) {
                // Circle center inside the box: push out along the shallower axis.
                const ox = h - Math.abs(rx), oy = h - Math.abs(ry);
                if (ox < oy) { mx = rx >= 0 ? 1 : -1; my = 0; pen = ox + rc; }
                else { mx = 0; my = ry >= 0 ? 1 : -1; pen = oy + rc; }
              } else {
                const ex = rx - qx, ey = ry - qy;
                const d2 = ex * ex + ey * ey;
                if (d2 >= rc * rc) continue;
                const d = sqrt(d2);
                mx = ex / d; my = ey / d;
                pen = rc - d;
              }
              if (bi === i) { nx = mx; ny = my; } else { nx = -mx; ny = -my; }
            }
            const wi = this.invMass[i], wj = this.invMass[j], ws = wi + wj;
            if (ws === 0) continue;
            const isSoft = this.soft[i] > 0 || this.soft[j] > 0;
            const k = isSoft ? corr * 0.2 : corr;
            const pk = pen * k;
            this.x[i] -= nx * pk * (wi / ws); this.y[i] -= ny * pk * (wi / ws);
            this.x[j] += nx * pk * (wj / ws); this.y[j] += ny * pk * (wj / ws);
            const vn = (this.vx[j] - this.vx[i]) * nx + (this.vy[j] - this.vy[i]) * ny;
            if (vn >= 0) continue;
            const rest = isSoft || -vn < restT ? 0 : this.restitution[i] * this.restitution[j];
            const imp = (-(1 + rest) * vn) / ws;
            this.vx[i] -= nx * imp * wi; this.vy[i] -= ny * imp * wi;
            this.vx[j] += nx * imp * wj; this.vy[j] += ny * imp * wj;
            if (-vn >= minImpact) {
              this.pushContact(CONTACT_BODY, i, j, -1,
                this.x[i] + nx * this.r[i], this.y[i] + ny * this.r[i], nx, ny, -vn);
            }
          }
        }
      }
    }
  }

  private detectTetherTouches(): void {
    const g = this.tetherGrid;
    const P = this.tmp;
    g.begin();
    for (let t = 0; t < this.tetherHigh; t++) {
      if (!this.tAlive[t]) continue;
      const i = this.tBody[t];
      this.tetherAnchor(t, P);
      g.add(t, Math.min(this.x[i], P.x), Math.min(this.y[i], P.y), Math.max(this.x[i], P.x), Math.max(this.y[i], P.y));
    }
    g.build();
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      const r = this.r[i];
      const bx = this.x[i], by = this.y[i];
      const x0 = g.cellOf(bx - r), x1 = g.cellOf(bx + r), y0 = g.cellOf(by - r), y1 = g.cellOf(by + r);
      const stamp = ++this.stamp;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const hi = g.bucketHi(cx, cy);
          for (let e = g.bucketLo(cx, cy); e < hi; e++) {
            if (g.entryCx[e] !== cx || g.entryCy[e] !== cy) continue;
            const t = g.entryItem[e];
            if (this.tStamp[t] === stamp) continue;
            this.tStamp[t] = stamp;
            const owner = this.tBody[t];
            if (owner === i || (this.tKind[t] === 2 && this.tRef[t] === i)) continue;
            if (!(this.layer[i] & this.mask[owner]) || !(this.layer[owner] & this.mask[i])) continue;
            this.tetherAnchor(t, P);
            const ax = this.x[owner], ay = this.y[owner];
            const ex = P.x - ax, ey = P.y - ay;
            const L2 = ex * ex + ey * ey;
            let u = L2 > 0 ? ((bx - ax) * ex + (by - ay) * ey) / L2 : 0;
            if (u < 0) u = 0; else if (u > 1) u = 1;
            const qx = ax + ex * u, qy = ay + ey * u;
            const ddx = bx - qx, ddy = by - qy;
            if (ddx * ddx + ddy * ddy >= r * r) continue;
            this.pushContact(CONTACT_TETHER, i, owner, t, qx, qy, 0, 0, 0);
          }
        }
      }
    }
  }

  private pushContact(kind: number, a: number, b: number, c: number,
    px: number, py: number, nx: number, ny: number, speed: number): void {
    const k = this.contactCount;
    if (k >= this.cfg.contactCapacity) {
      this.stats.contactsDropped++;
      return;
    }
    this.cKind[k] = kind; this.cA[k] = a; this.cB[k] = b; this.cC[k] = c;
    this.cPx[k] = px; this.cPy[k] = py; this.cNx[k] = nx; this.cNy[k] = ny; this.cSpeed[k] = speed;
    this.contactCount = k + 1;
  }

  /* --------------------------- Utilities -------------------------- */

  /** FNV-1a over the exact bits of all body state. Equal hashes = identical runs. */
  stateHash(): number {
    const buf = new Float64Array(1);
    const u = new Uint32Array(buf.buffer);
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      buf[0] = v;
      h = Math.imul(h ^ u[0], 0x01000193);
      h = Math.imul(h ^ u[1], 0x01000193);
    };
    mix(this.stepCount);
    for (let i = 0; i < this.highWater; i++) {
      if (!this.alive[i]) continue;
      mix(i); mix(this.x[i]); mix(this.y[i]); mix(this.vx[i]); mix(this.vy[i]); mix(this.r[i]);
    }
    for (let t = 0; t < this.tetherHigh; t++) if (this.tAlive[t]) { mix(t); mix(this.tBody[t]); }
    for (let id = 0; id < this.colAlive.length; id++) if (this.colAlive[id]) { mix(id); mix(this.colAngle[id]); }
    return h >>> 0;
  }
}
