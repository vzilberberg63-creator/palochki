/**
 * Холст фиксированного «мира» W×H, вписанный в экран с полями, и игровой цикл.
 * Игры рисуют в координатах мира и не думают о размере экрана и devicePixelRatio.
 */

export interface StageOptions {
  width: number;
  height: number;
  /** Сверху оставить место под HUD (CSS px). */
  top?: number;
}

export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  private dpr = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly opts: StageOptions,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get width(): number {
    return this.opts.width;
  }
  get height(): number {
    return this.opts.height;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const top = this.opts.top ?? 56;
    const pad = 8;
    this.scale = Math.min((w - pad * 2) / this.opts.width, (h - top - pad) / this.opts.height);
    this.offsetX = (w - this.opts.width * this.scale) / 2;
    this.offsetY = top + (h - top - pad - this.opts.height * this.scale) / 2;
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    return { x: (clientX - this.offsetX) / this.scale, y: (clientY - this.offsetY) / this.scale };
  }

  /** Очистить весь экран фоном и перейти в координаты мира. */
  begin(background: string | ((ctx: CanvasRenderingContext2D, w: number, h: number) => void)): CanvasRenderingContext2D {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (typeof background === 'string') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else background(ctx, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, this.offsetX * this.dpr, this.offsetY * this.dpr);
    return ctx;
  }
}

/** Цикл с фиксированным шагом: логика 60 раз в секунду, рисование — каждый кадр. */
export function runLoop(update: (dt: number) => void, draw: (dt: number) => void): void {
  const STEP = 1 / 60;
  let last = 0;
  let acc = 0;
  const frame = (ts: number) => {
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
    last = ts;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      update(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
    draw(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
