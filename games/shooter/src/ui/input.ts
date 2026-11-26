/**
 * Relative drag: the squad moves by how far the finger moves, not to where it
 * is, so a thumb never has to cover the squad. Arrow keys / A-D for desktop.
 */
export class DragInput {
  /** World units of movement waiting to be applied. */
  private pending = 0;
  private lastX: number | null = null;
  private keys = 0;
  private pointer = -1;
  sensitivity = 1.25;

  constructor(private el: HTMLElement, private pxPerUnit: () => number) {
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.key);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('keyup', this.key);
  }

  /** Returns world units to move this frame. */
  take(dt: number): number {
    const d = this.pending + this.keys * 420 * dt;
    this.pending = 0;
    return d;
  }

  private down = (e: PointerEvent) => {
    if (this.pointer !== -1) return;
    this.pointer = e.pointerId;
    this.lastX = e.clientX;
    e.preventDefault();
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer || this.lastX === null) return;
    this.pending += ((e.clientX - this.lastX) / this.pxPerUnit()) * this.sensitivity;
    this.lastX = e.clientX;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.lastX = null;
  };

  private key = (e: KeyboardEvent) => {
    const down = e.type === 'keydown';
    const k = e.key.toLowerCase();
    const bit = k === 'arrowleft' || k === 'a' ? 1 : k === 'arrowright' || k === 'd' ? 2 : 0;
    if (!bit) return;
    this.keyState = down ? this.keyState | bit : this.keyState & ~bit;
    this.keys = (this.keyState & 2 ? 1 : 0) - (this.keyState & 1 ? 1 : 0);
  };
  private keyState = 0;
}
