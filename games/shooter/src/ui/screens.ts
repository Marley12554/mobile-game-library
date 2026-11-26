import type { AbilityId, EnemyKind, LevelData, SquadType, WeaponId } from '../game/types';
import { WORLDS, findLevel, nextLevelId } from '../game/levels';
import { WEAPONS, WEAPON_ORDER } from '../game/weapons';
import { ENEMIES } from '../game/enemies';
import { SQUADS, SQUAD_ORDER, ABILITIES, ABILITY_ORDER, UPGRADES } from '../game/loadout';
import { BOSS_NAMES } from '../game/bosses';
import type { Sim } from '../game/sim';
import { Renderer } from '../render/renderer';
import { unitSprite } from '../render/sprites';
import { Play } from './play';
import { getSound } from './audio';
import { loadSave, writeSave, type SaveData } from '../meta/save';
import {
  levelUnlocked, worldUnlocked, weaponUnlocked, squadUnlocked, abilityUnlocked, unlockSource,
  unlocksFrom, totalStars, freeStars, buyUpgrade, refundAll, fixLoadout, threatsOf, cleared,
} from '../meta/progression';

type Child = Node | string | null | false | undefined;
function h(tag: string, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const starStr = (n: number, of = 3) => '★'.repeat(n) + '☆'.repeat(of - n);

function enemyIcon(kind: EnemyKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 72;
  c.className = 'icon';
  const g = c.getContext('2d')!;
  const r = 10;
  const sp = unitSprite(kind, r, 0);
  const k = 2.2;
  g.drawImage(sp.c, 32 - sp.ax * k, 64 - sp.ay * k, sp.w * k, sp.h * k);
  return c;
}

/** The whole shooter app: screens and the canvas behind them. */
export class App {
  private save: SaveData;
  private renderer: Renderer;
  private play: Play | null = null;
  private ui: HTMLElement;
  private hud: HTMLElement;
  private world = 0;
  private current: LevelData | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, hud: HTMLElement) {
    this.save = loadSave();
    fixLoadout(this.save);
    this.renderer = new Renderer(canvas);
    this.ui = ui;
    this.hud = hud;
    const snd = getSound();
    snd.enabled = this.save.sound;
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => { snd.unlock(); };
    window.addEventListener('pointerdown', unlock, { capture: true });
    // Start on the furthest unlocked world.
    for (let i = 0; i < WORLDS.length; i++) if (worldUnlocked(this.save, i)) this.world = i;
    if (new URLSearchParams(location.search).get('watch')) { this.demo(); this.show(); }
    else this.title();
  }

  private persist(): void { writeSave(this.save); }
  private click(): void { getSound().play('click'); }

  private show(...nodes: HTMLElement[]): void {
    this.ui.innerHTML = '';
    this.ui.append(...nodes);
    this.ui.classList.toggle('hidden', nodes.length === 0);
  }

  private stopPlay(): void {
    this.play?.dispose();
    this.play = null;
  }

  private demo(): void {
    this.stopPlay();
    // ?watch=<level id> lets the bot play any level (nothing is saved). Handy for previewing.
    const watch = findLevel(new URLSearchParams(location.search).get('watch') ?? '')?.level;
    const lvl = watch ?? WORLDS[0].levels[2];
    this.play = new Play(this.renderer, this.hud, { ...lvl, hint: undefined }, { weapon: 'rifle', squad: 'rookies', ability: 'grenade' }, {}, {
      onEnd: () => this.demo(), onPause: () => {},
    }, true);
  }

  /* ------------------------------------------------------------------ */

  title(): void {
    this.demo();
    this.show(h('div', { class: 'screen title-screen dim' },
      h('div', { class: 'logo' }, h('span', { class: 'l1' }, 'ZOMBIE'), h('span', { class: 'l2' }, 'GATES')),
      h('p', { class: 'tag' }, 'The game from the ad. No ads.'),
      h('button', { class: 'btn big', onclick: () => { this.click(); this.map(); } }, 'Play'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small ghost', onclick: () => { this.click(); this.upgrades(); } }, `Upgrades ★${freeStars(this.save)}`),
        this.soundToggle()),
    ));
  }

  private soundToggle(): HTMLElement {
    const b = h('button', { class: 'btn small ghost' }, this.save.sound ? 'Sound on' : 'Sound off');
    b.addEventListener('click', () => {
      this.save.sound = !this.save.sound;
      getSound().enabled = this.save.sound;
      b.textContent = this.save.sound ? 'Sound on' : 'Sound off';
      this.persist();
      this.click();
    });
    return b;
  }

  map(): void {
    if (!this.play) this.demo();
    const w = WORLDS[this.world];
    const tabs = h('div', { class: 'tabs' }, ...WORLDS.map((wd, i) => {
      const open = worldUnlocked(this.save, i);
      return h('button', {
        class: `tab ${i === this.world ? 'on' : ''} ${open ? '' : 'locked'}`,
        onclick: () => { if (!open) return; this.click(); this.world = i; this.map(); },
      }, open ? String(i + 1) : '🔒');
    }));
    const grid = h('div', { class: 'grid' }, ...w.levels.map((l, k) => {
      const open = levelUnlocked(this.save, l.id);
      const st = this.save.stars[l.id] ?? 0;
      return h('button', {
        class: `lvl ${l.boss ? 'boss' : ''} ${open ? '' : 'locked'} ${st ? 'done' : ''}`,
        onclick: () => { if (!open) return; this.click(); this.brief(l); },
      },
      h('span', { class: 'num' }, open ? (l.boss ? '☠' : String(k + 1)) : '🔒'),
      h('span', { class: 'stars' }, open ? starStr(st) : ''),
      h('span', { class: 'name' }, open ? l.name : ''));
    }));
    this.show(h('div', { class: 'screen map-screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn small ghost', onclick: () => { this.click(); this.title(); } }, '‹'),
        h('div', { class: 'stars-total' }, `★ ${totalStars(this.save)} / ${WORLDS.length * 24}`),
        h('button', { class: 'btn small', onclick: () => { this.click(); this.upgrades(); } }, `Upgrades ★${freeStars(this.save)}`)),
      tabs,
      h('div', { class: 'panel' },
        h('h2', {}, `World ${w.id}: ${w.name}`),
        h('p', { class: 'muted' }, w.intro),
        grid),
    ));
  }

  brief(l: LevelData): void {
    this.current = l;
    fixLoadout(this.save);
    const lo = this.save.loadout;
    const threats = threatsOf(l);
    const prize = l.prizes?.[0];
    const prizeName = prize ? prizeLabel(prize.r) : '';
    const goal2 = l.prizes?.length ? `Break the frozen ${prizeName.toLowerCase()}` : `Finish with ${l.stars[0]}+`;

    const pick = <T extends string>(title: string, order: T[], cur: T, name: (t: T) => string, sub: (t: T) => string, ok: (t: T) => boolean, src: (t: T) => string | null, set: (t: T) => void) =>
      h('div', { class: 'pick' },
        h('h3', {}, title),
        h('div', { class: 'cards' }, ...order.map((t) => {
          const open = ok(t);
          const s = src(t);
          return h('button', {
            class: `card ${t === cur ? 'on' : ''} ${open ? '' : 'locked'}`,
            onclick: () => { if (!open) return; this.click(); set(t); this.persist(); this.brief(l); },
          }, h('b', {}, open ? name(t) : '🔒'), h('small', {}, open ? sub(t) : s ? `Beat ${s}` : ''));
        })));

    const best = this.save.best[l.id];
    this.show(h('div', { class: 'screen brief-screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn small ghost', onclick: () => { this.click(); this.map(); } }, '‹'),
        h('div', { class: 'stars-total' }, `${l.id}  ${starStr(this.save.stars[l.id] ?? 0)}`),
        h('span', {})),
      h('div', { class: 'panel scroll' },
        h('h2', {}, l.boss ? `☠ ${BOSS_NAMES[l.boss.kind]}` : l.name),
        l.hint ? h('p', { class: 'muted' }, l.hint) : null,
        h('div', { class: 'threats' }, ...threats.map((k) => h('div', { class: 'threat' }, enemyIcon(k), h('span', {}, ENEMIES[k].name)))),
        h('ul', { class: 'goals' },
          h('li', {}, '★ Clear the level'),
          h('li', {}, `★ ${goal2}`),
          h('li', {}, `★ Finish with ${l.stars[1]}+ soldiers`),
          best !== undefined ? h('li', { class: 'muted' }, `Best: ${best} soldiers`) : null),
        pick<WeaponId>('Weapon', WEAPON_ORDER, lo.weapon, (t) => WEAPONS[t].name, (t) => `+ ${WEAPONS[t].strong}\n− ${WEAPONS[t].weak}`,
          (t) => weaponUnlocked(this.save, t), (t) => unlockSource('weapon', t), (t) => { lo.weapon = t; }),
        pick<SquadType>('Squad', SQUAD_ORDER, lo.squad, (t) => SQUADS[t].name, (t) => SQUADS[t].blurb,
          (t) => squadUnlocked(this.save, t), (t) => unlockSource('squad', t), (t) => { lo.squad = t; }),
        pick<AbilityId>('Ability', ABILITY_ORDER, lo.ability, (t) => ABILITIES[t].name, (t) => `${ABILITIES[t].blurb} (${ABILITIES[t].cooldown}s)`,
          (t) => abilityUnlocked(this.save, t), (t) => unlockSource('ability', t), (t) => { lo.ability = t; })),
      h('div', { class: 'footer' },
        h('button', { class: 'btn big', onclick: () => { this.click(); this.start(l); } }, 'Start')),
    ));
  }

  private start(l: LevelData): void {
    this.stopPlay();
    this.show();
    this.current = l;
    this.play = new Play(this.renderer, this.hud, l, { ...this.save.loadout }, { ...this.save.upgrades }, {
      onEnd: (sim) => this.results(sim),
      onPause: () => this.pause(),
    });
  }

  private pause(): void {
    const l = this.current!;
    this.show(h('div', { class: 'screen overlay' },
      h('div', { class: 'panel narrow' },
        h('h2', {}, 'Paused'),
        h('button', { class: 'btn big', onclick: () => { this.click(); this.show(); this.play?.setPaused(false); } }, 'Resume'),
        h('button', { class: 'btn', onclick: () => { this.click(); this.start(l); } }, 'Restart'),
        h('button', { class: 'btn ghost', onclick: () => { this.click(); this.stopPlay(); this.brief(l); } }, 'Quit'),
        this.soundToggle())));
  }

  private results(sim: Sim): void {
    const l = sim.level;
    const win = sim.result === 'win';
    const before = this.save.stars[l.id] ?? 0;
    const wasCleared = cleared(this.save, l.id);
    let newUnlocks: string[] = [];
    if (win) {
      this.save.stars[l.id] = Math.max(before, sim.stars);
      this.save.best[l.id] = Math.max(this.save.best[l.id] ?? 0, sim.count);
      if (!wasCleared) newUnlocks = unlocksFrom(l.id);
      this.persist();
    }
    const gained = Math.max(0, (this.save.stars[l.id] ?? 0) - before);
    const next = nextLevelId(l.id);
    const labels = ['Clear', l.prizes?.length ? 'Prize' : `${l.stars[0]}+ left`, `${l.stars[1]}+ left`];
    this.show(h('div', { class: 'screen overlay' },
      h('div', { class: `panel narrow result ${win ? 'win' : 'lose'}` },
        h('h2', {}, win ? 'Cleared!' : 'Overrun'),
        win ? h('div', { class: 'bigstars' }, ...sim.starFlags.map((f, k) => h('div', { class: `bs ${f ? 'on' : ''}`, style: `animation-delay:${k * 0.18}s` }, h('span', {}, f ? '★' : '☆'), h('small', {}, labels[k])))) : null,
        h('div', { class: 'stats' },
          h('div', {}, h('b', {}, String(sim.count)), h('small', {}, 'survivors')),
          h('div', {}, h('b', {}, String(sim.peak)), h('small', {}, 'peak squad')),
          h('div', {}, h('b', {}, String(sim.kills)), h('small', {}, 'kills'))),
        !win ? h('p', { class: 'muted' }, loseTip(sim)) : null,
        gained > 0 ? h('p', { class: 'gain' }, `+${gained} ★ to spend on upgrades`) : null,
        ...newUnlocks.map((u) => h('p', { class: 'unlock' }, `Unlocked ${u}`)),
        win && next && levelUnlocked(this.save, next)
          ? h('button', { class: 'btn big', onclick: () => { this.click(); const f = findLevel(next)!; this.world = WORLDS.indexOf(f.world); this.brief(f.level); } }, 'Next')
          : null,
        h('button', { class: `btn ${win ? '' : 'big'}`, onclick: () => { this.click(); this.start(l); } }, 'Retry'),
        h('button', { class: 'btn ghost', onclick: () => { this.click(); this.stopPlay(); this.brief(l); } }, 'Change loadout'),
        h('button', { class: 'btn ghost', onclick: () => { this.click(); this.stopPlay(); this.map(); } }, 'Levels'))));
  }

  upgrades(): void {
    if (!this.play) this.demo();
    const rows = UPGRADES.map((u) => {
      const lv = this.save.upgrades[u.id] ?? 0;
      const maxed = lv >= u.costs.length;
      const cost = maxed ? 0 : u.costs[lv];
      const can = !maxed && freeStars(this.save) >= cost;
      return h('div', { class: 'upg' },
        h('div', {}, h('b', {}, u.name), h('small', {}, u.blurb),
          h('div', { class: 'pips' }, ...u.costs.map((_, k) => h('i', { class: k < lv ? 'on' : '' })))),
        h('button', {
          class: `btn small ${can ? '' : 'off'}`,
          onclick: () => { if (buyUpgrade(this.save, u.id)) { this.click(); this.persist(); this.upgrades(); } },
        }, maxed ? 'Max' : `★ ${cost}`));
    });
    this.show(h('div', { class: 'screen map-screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'btn small ghost', onclick: () => { this.click(); this.map(); } }, '‹'),
        h('div', { class: 'stars-total' }, `★ ${freeStars(this.save)} to spend`),
        h('button', { class: 'btn small ghost', onclick: () => { refundAll(this.save); this.persist(); this.click(); this.upgrades(); } }, 'Refund all')),
      h('div', { class: 'panel scroll' },
        h('h2', {}, 'Upgrades'),
        h('p', { class: 'muted' }, 'Stars from levels buy small, permanent boosts. They help on a stuck level, but they will not carry you. Refunds are free.'),
        ...rows)));
  }
}

function prizeLabel(r: string): string {
  const [k, a] = r.split(':');
  if (k === 'mech') return 'Mech';
  if (k === 'weapon') return WEAPONS[a as WeaponId].name;
  return 'Reinforcements';
}

function loseTip(sim: Sim): string {
  const l = sim.level;
  if (sim.boss) return 'Bosses repeat their patterns. Watch for the warning stripes and the moment it opens up.';
  const kinds = new Set((l.waves ?? []).map((w) => w.t));
  if (kinds.has('armored') && sim.lo.weapon !== 'piercer') return 'Armor shrugs off weak hits. Try the Piercer or a damage gate.';
  if (kinds.has('shielded') && !['spread', 'launcher'].includes(sim.lo.weapon)) return 'Shields block straight shots. Angled pellets and explosions get around them.';
  if (kinds.has('splitter') && sim.lo.weapon === 'launcher') return 'Explosions make splitters burst into twice as many. Try a bullet weapon.';
  if (kinds.has('thief')) return 'Thieves turn your best gates bad. Shoot them before they reach one.';
  if (sim.prizes.some((p) => p.state === 'broken') === false && sim.prizes.length) return 'The prize is a gamble. Sometimes the right call is to leave it in the ice.';
  return 'Bigger squads cover more of the road. Grab the gates that grow you early.';
}
