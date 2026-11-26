# engine

Deterministic 2D physics for many circles against walls, rings with gaps and tracks. Shared by `/games/ball-sim` and later `/games/shooter`. No rendering and no game rules in here.

Two parts: the physics world (`world.ts` and friends) and a generic rule graph (`rules.ts`). Game-specific blocks live in the game, not here.

## Determinism rules

Same inputs, same seed, same step count means bit-identical state on every browser. To keep that true:

- Never use `Math.sin/cos/tan/atan2/exp/pow/hypot/random` in simulation code. Use `dmath` (`sin`, `cos`, `atan`, `atan2`, `sqrt`, `wrapAngle`) and `Rng`.
- The timestep is fixed (`cfg.dt`, default 1/120 s). Playback speed and slowdown change how many steps run per frame, never the step size.
- Iteration order is always ascending index. Grids preserve insertion order.
- Mutate the world (create, destroy, tethers, colliders) only between `step()` calls.
- `world.stateHash()` hashes the exact bits of all state. Use it in tests to compare runs.

## World

```ts
import { World, ring, Rng } from '@engine/index';

const world = new World({ capacity: 5000, gravityY: 400 });
const ringId = world.addCollider({ pieces: ring(200, 2, [{ at: 0, width: 0.4 }]), angularVelocity: 1 });
const ball = world.createBody({ x: 0, y: 0, vx: 300, vy: 120, radius: 6 });
world.step();
```

### Config (`WorldConfig`)

| field | default | meaning |
|---|---|---|
| `capacity` | 20000 | object cap. `createBody` returns -1 past it |
| `tetherCapacity` | 20000 | tether cap. `addTether` returns -1 past it |
| `contactCapacity` | 20000 | contacts reported per step. Extras still resolve, just unreported |
| `dt` | 1/120 | fixed step, seconds |
| `gravityX/Y` | 0 | world gravity (also mutable as `world.gravityX/Y`) |
| `gravityMode` | `'linear'` | `'point'` pulls toward `gravityCx/Cy` with strength `|(gravityX, gravityY)|` |
| `cellSize` | 24 | grid cell size, about 2x a typical ball radius |
| `maxSpeed` | 6000 | hard speed clamp, bounds substep cost |
| `maxSubsteps` | 32 | per body per step against walls |
| `minImpactSpeed` | 1 | slower impacts are resolved but not reported |
| `detectTetherTouch` | true | report bodies crossing other bodies' tethers |
| `pairCorrection` | 1 | fraction of body-body overlap removed per step. Lower lets crowds compress so containers fill solid |
| `restThreshold` | 0 | impacts slower than this get zero restitution, so piles settle instead of jittering |

### Bodies

Circles or axis-aligned squares (`shape: 'box'`, half-size `radius`, never rotates), stored as flat typed arrays indexed by slot: `x, y, vx, vy, r, invMass, restitution, damping, gravityScale, layer, mask, group, alive, tetherCount, shape, frozen, soft`.

- `frozen[i] = 1` takes a body out of play: it doesn't move or collide until cleared.
- `soft[i]` (seconds) makes a body push apart gently with no bounce, for bodies placed into a crowd. Hot code reads and writes these directly. Slots `0..highWater-1`, skip where `alive[i] === 0`.

- `createBody(def): handle | -1`
- `destroyBody(handle)`, `destroyIndex(i)`: also removes every tether on that body
- `indexOf(handle): i | -1`. Handles carry a generation, so stale handles return -1 after the slot is reused
- `handleAt(i)`, `isAlive(handle)`

Mass defaults to `radius^2`. `fixed: true` makes a body immovable by collisions. Restitution combines by multiplication (body x wall, body x body). Collision filter: `(A.layer & B.mask) && (B.layer & A.mask)`. `group` is a free integer for the rule layer (teams, object groups).

### Colliders (walls)

A collider is a transform (`x, y, angle`, plus `vx, vy, angularVelocity`) and a list of pieces in local space:

- `segment`: `ax, ay, bx, by, halfThickness`
- `arc`: `cx, cy, radius, start, span, halfThickness` (angles CCW from +x, radians)

Pieces are thick lines with round caps, so gap edges in a ring behave like rounded ends. Shape helpers in `shapes.ts`: `ring(radius, halfThickness, gaps)`, `segment`, `polyline`, `box`, `spiral`.

- `addCollider(def): id`, `removeCollider(id)` (also removes tethers anchored to it)
- `setColliderTransform(id, x, y, angle)`, `setColliderVelocity(id, vx, vy, w)`
- `setColliderScale(id, scale, scaleVelocity)`: scales pieces about the origin (thickness fixed). Bounces feel the moving wall
- `setArc(piece, radius, start, span, growth)`: reshape an arc in place, e.g. a ring that shrinks while its gap keeps a fixed width

Rings (colliders whose pieces are all arcs centered on the origin) skip the grid. Still rings sharing a center are kept sorted by radius and found by binary search on a body's distance, so 10,000 concentric rings cost about the same as 10.
- `colliderToWorld(id, lx, ly, out)`

Rotation costs nothing extra if the collider was created with `angularVelocity` or `rotates: true` (it's registered with a rotation-proof bound). Translation rebuilds the static grid that step. To drive motion (swing, slide), set velocities each step with `setColliderVelocity` so the world integrates to the target pose.

### Tethers

A tether ties a body to a fixed point, a point on a collider (moves and rotates with it) or another body.

```ts
world.addTether({
  body: ball,
  anchor: { kind: 'collider', collider: ringId, x: px, y: py }, // world point, stored in collider space
  restLength: 0,     // slack below this. Default: current distance
  stiffness: 20,     // per unit mass, 1/s^2. 0 = visual only. Clamped for stability
  damping: 1,
  maxLength: Infinity, // hard rope limit
});
```

`removeTether(handle)`, `tetherIndexOf`, `tetherHandleAt`, `tetherAnchor(t, out)`. Per-body count in `world.tetherCount[i]`.

### Contacts

After each `step()`, `contactCount` entries in flat arrays: `cKind, cA, cB, cC, cPx, cPy, cNx, cNy, cSpeed`.

| `cKind` | `cA` | `cB` | `cC` | notes |
|---|---|---|---|---|
| `CONTACT_WALL` | body index | collider id | piece index | one per body per collider per substep, approach speed >= `minImpactSpeed` |
| `CONTACT_BODY` | body index (lower) | body index | -1 | normal points from A to B |
| `CONTACT_TETHER` | toucher index | tether owner index | tether index | reported every step while overlapping. Owners never touch their own tethers |

Body-body contacts only report on approach, so resting contact doesn't spam. Tether contacts are not edge-filtered yet.

### Step order

1. Advance kinematic colliders.
2. Rebuild the static grid if colliders moved or changed.
3. Apply tether springs and rope limits.
4. Integrate bodies (gravity, damping, speed clamp), substepping each body against walls so it never moves more than half its contact radius per substep. This is what stops fast balls passing through walls. Within a substep, overlapping wall pieces resolve deepest first, so polyline joints don't produce skewed corner normals.
5. Body-body pass via the spatial hash. Each overlapping pair is handled once, in the first cell both cover. Circle-circle, box-box and box-circle.
6. Final wall pass: walls get the last word, so crowds can't push bodies through them.
7. Tether touch detection.

Known limits: body-body has no swept test, so two tiny, very fast balls can pass through each other. Squares never rotate, and squares against arcs are treated as circles.

## Runner

```ts
const runner = new Runner(() => world.step(), { dt: world.cfg.dt, budgetMs: 10 });
// each animation frame:
runner.frame(elapsedSeconds);
```

Runs as many fixed steps as real time times `speed` calls for, but never more than `budgetMs` of work or `maxStepsPerFrame` steps per frame. If it can't keep up, it drops the backlog and plays slower (`overloaded`, `effectiveSpeed`). The result is identical to a full-speed run.

## Guards

| guard | where | behavior |
|---|---|---|
| object cap | `createBody` | returns -1, `stats.spawnRefused++` |
| tether cap | `addTether` | returns -1, `stats.tetherRefused++` |
| contact cap | per step | extra contacts resolve unreported, `stats.contactsDropped++` |
| substep cap | integrate | `stats.substepCapHits++`. Raise `maxSubsteps` or lower `maxSpeed` |
| speed clamp | integrate | velocity scaled to `maxSpeed` |
| frame budget | `Runner` | slowdown instead of freezing |
| trigger firings per step | `Dispatcher` | `maxFiringsPerStep` (default 4000). Excess dropped in fixed order, `stats.firingsDropped++` |

## Rule graph (`rules.ts`)

Generic objects → triggers → filters → actions graphs with typed connections. No ball-specific code.

**Context bits** describe what an event knows: `CTX_SELF`, `CTX_OTHER`, `CTX_POINT`, `CTX_TETHER`. A trigger *provides* a mask. Filters and actions *need* a mask. A wire is valid when `need ⊆ provided`. Filters pass through the intersection of their inputs.

**Blocks** (`BlockSpec`): `type`, `category` (`object | trigger | filter | action`), `label`, `params: ParamSpec[]`, plus:
- objects: `kind`, `output` (can wire into triggers)
- triggers: `objectInput` (`none | optional | required`), `provides(params, hasObject)`
- filters/actions: `needs(params)`, or per-option `needs` on enum params (e.g. target "other" needs `CTX_OTHER`)
- `summary(params, nameOf)` for node faces

`Registry.add(spec)` appends `cooldown` and `maxFires` params to every trigger.

**Graph** (`GraphDef`): `nodes: {id, type, x, y, params}[]`, `wires: {from, to}[]`.
- `analyzeGraph(g, reg)` returns provided/needed masks, per-wire errors (`kind`, `shape`, `needs objects`, `loop`), valid children and each trigger's object inputs.
- `canConnect(g, reg, from, to)` for editors: rejects duplicates, cycles and shape mismatches.
- `compileGraph(g, reg)` returns `CompiledTrigger[]` trees with defaults filled in.

**Dispatch**: `new Dispatcher<E>({ test, run }, maxFiringsPerStep)`. The game detects events and calls `dispatcher.fire(trigger, key, time, event)`, where `key` identifies the object for per-object cooldowns and max fires (-1 for sim-wide). Call `beginStep()` each step. Filters' `test` gates, actions' `run` act. To stay deterministic, actions should queue structural changes (spawn/destroy) and apply them after the step's events.

## Spatial hash

`SpatialHash` is reusable on its own: `begin()`, `add(item, minX, minY, maxX, maxY)`, `build()`, then scan `bucketLo..bucketHi` for a cell and filter entries by `entryCx/entryCy`. Rebuilt by counting sort, so it's allocation-free in steady state and deterministic.

## Tests

`npm test`. Covers dmath accuracy, RNG repeatability, tunneling at 20,000 units/s, gap escape, contact reporting, energy conservation, determinism across seeds and destroy/respawn, guards and tethers.

Rough cost on a desktop (Node 22): 1k balls 0.4 ms/step, 5k 2.1 ms, 10k 4.7 ms. Two steps per 60 fps frame.
