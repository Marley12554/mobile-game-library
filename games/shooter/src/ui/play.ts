import { Runner } from '@engine/index';
import { DT, TRACK_HALF } from '../game/config';
import { Sim } from '../game/sim';
import type { LevelData, Loadout, Perks } from '../game/types';
import { ABILITIES } from '../game/loadout';
import { botStep, newBot } from '../game/bot';
import { Renderer } from '../render/renderer';
import { DragInput } from './input';
import { getSound } from './audio';

export interface PlayHooks {
  onEnd(sim: Sim): void;
  onPause(): void;
}

/** Runs one level: fixed-step sim, rendering, input, HUD buttons. */
export class Play {
  readonly sim: Sim;
  private runner: Runner;
  private input: DragInput | null = null;
  private raf = 0;
  private last = 0;
  private endAt = 0;
  private ended = false;
  paused = false;
  private abilityBtn: HTMLButtonElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private bot = newBot();

  constructor(
    private renderer: Renderer,
    private hud: HTMLElement,
    level: LevelData,
    lo: Loadout,
    perks: Perks,
    private hooks: PlayHooks | null,
    /** Attract mode: the bot plays, no input, no HUD. */
    private demo = false,
  ) {
    this.sim = new Sim(level, lo, perks, demo ? 7 : (Date.now() & 0xffff) + 1);
    this.runner = new Runner(() => this.tick(), { dt: DT, budgetMs: 12, maxStepsPerFrame: 6 });
    renderer.sound = demo ? null : getSound();
    if (!demo) {
      this.input = new DragInput(renderer.canvas, () => renderer.pxPerUnit);
      this.buildHud();
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.vis);
  }

  private vis = () => { if (document.hidden && !this.demo && !this.ended) this.setPaused(true, true); };

  private buildHud(): void {
    this.hud.innerHTML = '';
    const pause = document.createElement('button');
    pause.className = 'hud-pause';
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = '<span></span><span></span>';
    pause.addEventListener('click', () => this.setPaused(true, true));
    const ab = document.createElement('button');
    ab.className = 'hud-ability';
    ab.innerHTML = `<span class="ab-ring"></span><span class="ab-label">${ABILITIES[this.sim.lo.ability].name}</span>`;
    ab.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.sim.useAbility()) navigator.vibrate?.(15);
    });
    this.hud.append(pause, ab);
    this.abilityBtn = ab;
    this.pauseBtn = pause;
  }

  setPaused(p: boolean, notify = false): void {
    if (this.ended) return;
    this.paused = p;
    this.runner.paused = p;
    if (p && notify) this.hooks?.onPause();
    if (!p) this.last = performance.now();
  }

  private tick(): void {
    if (this.demo) {
      botStep(this.sim, this.bot);
      if (this.sim.result) return;
    }
    this.sim.step();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) { this.renderer.draw(this.sim, 0); return; }
    if (this.input) {
      const d = this.input.take(dt);
      this.sim.targetX = Math.max(-TRACK_HALF, Math.min(TRACK_HALF, this.sim.targetX + d));
      // Keep the target from running far past where the leader can go.
      if (Math.abs(this.sim.targetX - this.sim.leaderX) > 120) this.sim.targetX = this.sim.leaderX + Math.sign(this.sim.targetX - this.sim.leaderX) * 120;
    }
    this.runner.frame(dt);
    this.renderer.consume(this.sim);
    this.renderer.draw(this.sim, dt);
    if (this.abilityBtn) {
      const f = this.sim.abilityMax > 0 ? 1 - this.sim.abilityCd / this.sim.abilityMax : 1;
      this.abilityBtn.style.setProperty('--cd', String(f));
      this.abilityBtn.classList.toggle('ready', f >= 1);
    }
    if (this.sim.result && !this.ended) {
      if (!this.endAt) this.endAt = now + (this.sim.result === 'win' ? 1300 : 1100);
      if (now >= this.endAt) {
        this.ended = true;
        this.hooks?.onEnd(this.sim);
      }
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input?.dispose();
    document.removeEventListener('visibilitychange', this.vis);
    this.abilityBtn?.remove();
    this.pauseBtn?.remove();
    if (!this.demo) this.hud.innerHTML = '';
  }
}
