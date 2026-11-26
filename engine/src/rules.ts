/**
 * Generic rule graph: blocks, typed connections, compilation and dispatch.
 *
 * A graph is nodes + wires. Four block categories:
 *   object  -> trigger -> filter* -> action
 * Objects wire into triggers ("these objects fire this trigger"). Triggers and
 * filters emit an event context. Each action and filter declares what context
 * it needs, and a wire is valid only if the source provides all of it.
 *
 * This module knows nothing about balls or rings. The game supplies block
 * specs (metadata) and implementations, and drives triggers from its own
 * detection code.
 */

/* Event context bits. Masks used by the built-in blocks form a chain
 * (none < self < self+point < self+other+point < +tether), so connector
 * shapes can show "more corners = more information". */
export const CTX_SELF = 1;
export const CTX_OTHER = 2;
export const CTX_POINT = 4;
export const CTX_TETHER = 8;

export type Params = Record<string, any>;

export type ParamType = 'number' | 'int' | 'angle' | 'enum' | 'bool' | 'text' | 'ref' | 'color' | 'look' | 'colors';

export interface ParamOption {
  value: string;
  label: string;
  /** Context this option needs from upstream (e.g. target "other" needs CTX_OTHER). */
  needs?: number;
}

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ParamOption[];
  /** For 'ref': object kinds that can be referenced. */
  refKinds?: string[];
  /** For 'ref': label of an extra "any" choice (value ''). */
  anyLabel?: string;
  showIf?: (p: Params) => boolean;
}

export type Category = 'object' | 'trigger' | 'filter' | 'action';

export interface BlockSpec {
  type: string;
  category: Category;
  label: string;
  /** Object blocks: the kind of object ('ball', 'ring', ...). */
  kind?: string;
  /** Object blocks: whether it can wire into triggers. */
  output?: boolean;
  params: ParamSpec[];
  /** Triggers: whether an object wire goes in. */
  objectInput?: 'none' | 'optional' | 'required';
  /** Triggers: context provided. */
  provides?: (p: Params, hasObject: boolean) => number;
  /** Filters/actions: context needed. Defaults to the union of chosen options' needs. */
  needs?: (p: Params) => number;
  /** One-line description of current params for the node face. */
  summary?: (p: Params, name: (id: string) => string) => string;
}

export interface NodeDef {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Params;
}

export interface WireDef {
  from: string;
  to: string;
}

export interface GraphDef {
  nodes: NodeDef[];
  wires: WireDef[];
}

/** Common trigger params, added to every trigger spec by the registry. */
export const TRIGGER_COMMON: ParamSpec[] = [
  { key: 'cooldown', label: 'Cooldown', type: 'number', default: 0, min: 0, max: 600, step: 0.05, unit: 's' },
  { key: 'maxFires', label: 'Max fires', type: 'int', default: 0, min: 0, max: 100000, step: 1 },
];

export class Registry<B extends BlockSpec = BlockSpec> {
  private map = new Map<string, B>();
  readonly order: B[] = [];

  add(b: B): void {
    if (this.map.has(b.type)) throw new Error(`duplicate block ${b.type}`);
    if (b.category === 'trigger') b.params = [...b.params, ...TRIGGER_COMMON];
    this.map.set(b.type, b);
    this.order.push(b);
  }

  get(type: string): B | undefined {
    return this.map.get(type);
  }

  byCategory(c: Category): B[] {
    return this.order.filter((b) => b.category === c);
  }
}

/** Fill missing params with defaults. Returns a new object. */
export function withDefaults(spec: BlockSpec, p: Params | undefined): Params {
  const out: Params = { ...(p ?? {}) };
  for (const ps of spec.params) {
    if (out[ps.key] === undefined) out[ps.key] = structuredCloneSafe(ps.default);
  }
  return out;
}

function structuredCloneSafe<T>(v: T): T {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

/** Context a filter/action node needs. */
export function needsOf(spec: BlockSpec, p: Params): number {
  if (spec.needs) return spec.needs(p);
  let m = 0;
  for (const ps of spec.params) {
    if (ps.type !== 'enum' || !ps.options) continue;
    if (ps.showIf && !ps.showIf(p)) continue;
    const opt = ps.options.find((o) => o.value === p[ps.key]);
    if (opt?.needs) m |= opt.needs;
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export interface GraphAnalysis {
  /** Context each trigger/filter emits (after its inputs). */
  provided: Map<string, number>;
  /** Context each filter/action needs. */
  needed: Map<string, number>;
  /** Per wire: '' if valid, otherwise a short reason. */
  wireError: string[];
  /** Valid outgoing edges per node (in wire order). */
  children: Map<string, string[]>;
  /** Object nodes feeding each trigger. */
  triggerObjects: Map<string, string[]>;
}

export function analyzeGraph(g: GraphDef, reg: Registry): GraphAnalysis {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const spec = (id: string) => {
    const n = nodes.get(id);
    return n ? reg.get(n.type) : undefined;
  };
  const provided = new Map<string, number>();
  const needed = new Map<string, number>();
  const wireError: string[] = new Array(g.wires.length).fill('');
  const children = new Map<string, string[]>();
  const triggerObjects = new Map<string, string[]>();
  const incoming = new Map<string, number[]>();

  for (const n of g.nodes) {
    const s = reg.get(n.type);
    if (!s) continue;
    if (s.category === 'filter' || s.category === 'action') needed.set(n.id, needsOf(s, n.params));
  }
  g.wires.forEach((w, k) => {
    const a = spec(w.from), b = spec(w.to);
    if (!a || !b) { wireError[k] = 'missing'; return; }
    if (w.from === w.to) { wireError[k] = 'loop'; return; }
    const ok =
      (a.category === 'object' && a.output !== false && b.category === 'trigger' && b.objectInput !== 'none') ||
      ((a.category === 'trigger' || a.category === 'filter') && (b.category === 'filter' || b.category === 'action'));
    if (!ok) { wireError[k] = 'kind'; return; }
    if (!incoming.has(w.to)) incoming.set(w.to, []);
    incoming.get(w.to)!.push(k);
  });

  // Triggers first: their output depends only on object inputs.
  for (const n of g.nodes) {
    const s = reg.get(n.type);
    if (s?.category !== 'trigger') continue;
    const objs = (incoming.get(n.id) ?? []).map((k) => g.wires[k].from);
    triggerObjects.set(n.id, objs);
    const has = objs.length > 0;
    provided.set(n.id, s.objectInput === 'required' && !has ? -1 : s.provides ? s.provides(n.params, has) : 0);
  }

  // Filters in dependency order. A filter's output is the intersection of its valid inputs.
  const filterIds = g.nodes.filter((n) => spec(n.id)?.category === 'filter').map((n) => n.id);
  const state = new Map<string, number>(); // 0 unvisited, 1 visiting, 2 done
  const visit = (id: string): number => {
    const st = state.get(id) ?? 0;
    if (st === 2) return provided.get(id) ?? -1;
    if (st === 1) return -1; // cycle
    state.set(id, 1);
    let m = -1;
    for (const k of incoming.get(id) ?? []) {
      const src = g.wires[k].from;
      const sc = spec(src)!.category;
      const pm = sc === 'filter' ? visit(src) : provided.get(src) ?? -1;
      if (pm < 0) continue;
      const need = needed.get(id) ?? 0;
      if ((need & pm) !== need) continue;
      m = m < 0 ? pm : m & pm;
    }
    state.set(id, 2);
    provided.set(id, m);
    return m;
  };
  for (const id of filterIds) visit(id);

  // Validate data wires.
  g.wires.forEach((w, k) => {
    if (wireError[k]) return;
    const a = spec(w.from)!;
    if (a.category === 'object') {
      push(children, w.from, w.to);
      return;
    }
    const pm = provided.get(w.from) ?? -1;
    if (pm < 0) {
      wireError[k] = a.category === 'trigger' ? 'needs objects' : 'no input';
      return;
    }
    const need = needed.get(w.to) ?? 0;
    if ((need & pm) !== need) { wireError[k] = 'shape'; return; }
    if (state.get(w.to) === 1) { wireError[k] = 'loop'; return; }
    push(children, w.from, w.to);
  });

  return { provided, needed, wireError, children, triggerObjects };
}

function push(m: Map<string, string[]>, k: string, v: string) {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

/** Would a wire from -> to be accepted? Used by the editor while dragging. */
export function canConnect(g: GraphDef, reg: Registry, from: string, to: string): boolean {
  if (from === to) return false;
  if (g.wires.some((w) => w.from === from && w.to === to)) return false;
  // Reject cycles: is `from` reachable from `to`?
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of g.wires) if (w.from === id) stack.push(w.to);
  }
  const trial: GraphDef = { nodes: g.nodes, wires: [...g.wires, { from, to }] };
  const a = analyzeGraph(trial, reg);
  return a.wireError[trial.wires.length - 1] === '';
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

export interface CompiledNode {
  id: string;
  type: string;
  category: Category;
  params: Params;
  children: CompiledNode[];
  /** Fire counter for "every Nth" style filters. */
  counter: number;
}

export interface CompiledTrigger extends CompiledNode {
  objects: string[];
  cooldown: number;
  maxFires: number;
  lastFire: Map<number, number>;
  fires: Map<number, number>;
}

export function compileGraph(g: GraphDef, reg: Registry): CompiledTrigger[] {
  const a = analyzeGraph(g, reg);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const make = (id: string, depth: number): CompiledNode | null => {
    const n = byId.get(id)!;
    const s = reg.get(n.type)!;
    if (depth > 64) return null;
    const node: CompiledNode = { id, type: n.type, category: s.category, params: withDefaults(s, n.params), children: [], counter: 0 };
    for (const c of a.children.get(id) ?? []) {
      const cn = make(c, depth + 1);
      if (cn) node.children.push(cn);
    }
    return node;
  };
  const out: CompiledTrigger[] = [];
  for (const n of g.nodes) {
    const s = reg.get(n.type);
    if (s?.category !== 'trigger') continue;
    if ((a.provided.get(n.id) ?? -1) < 0) continue;
    const base = make(n.id, 0)!;
    out.push({
      ...base,
      objects: a.triggerObjects.get(n.id) ?? [],
      cooldown: Number(base.params.cooldown) || 0,
      maxFires: Number(base.params.maxFires) || 0,
      lastFire: new Map(),
      fires: new Map(),
    });
  }
  return out;
}

export interface DispatchHooks<E> {
  test(node: CompiledNode, e: E): boolean;
  run(node: CompiledNode, e: E): void;
}

/**
 * Runs trigger chains with per-object cooldowns, max fires and a global
 * per-step firing cap. Firings past the cap are dropped in a fixed order, so
 * results stay deterministic.
 */
export class Dispatcher<E> {
  maxFiringsPerStep: number;
  firingsThisStep = 0;
  readonly stats = { firingsDropped: 0, firings: 0 };

  constructor(private hooks: DispatchHooks<E>, maxFiringsPerStep = 4000) {
    this.maxFiringsPerStep = maxFiringsPerStep;
  }

  beginStep(): void {
    this.firingsThisStep = 0;
  }

  /** `key` identifies the object for cooldowns (-1 for sim-wide triggers). */
  fire(t: CompiledTrigger, key: number, time: number, e: E): boolean {
    if (t.cooldown > 0) {
      const last = t.lastFire.get(key);
      if (last !== undefined && time - last < t.cooldown - 1e-9) return false;
    }
    if (t.maxFires > 0 && (t.fires.get(key) ?? 0) >= t.maxFires) return false;
    if (this.firingsThisStep >= this.maxFiringsPerStep) {
      this.stats.firingsDropped++;
      return false;
    }
    this.firingsThisStep++;
    this.stats.firings++;
    if (t.cooldown > 0) t.lastFire.set(key, time);
    if (t.maxFires > 0) t.fires.set(key, (t.fires.get(key) ?? 0) + 1);
    for (const c of t.children) this.walk(c, e);
    return true;
  }

  private walk(n: CompiledNode, e: E): void {
    if (n.category === 'filter') {
      if (!this.hooks.test(n, e)) return;
      for (const c of n.children) this.walk(c, e);
    } else if (n.category === 'action') {
      this.hooks.run(n, e);
    }
  }
}
