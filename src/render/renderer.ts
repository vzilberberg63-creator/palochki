import { GRAIN_KINDS, GrainKind } from '../core/grains';
import type { GameEvent, Grain, Session, Tray } from '../core/session';
import { TABLE_BOTTOM, WORLD_H, WORLD_W } from '../core/world';

interface GrainColors {
  base: string;
  light: string;
  dark: string;
  mark: string;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

interface RingFx {
  x: number;
  y: number;
  color: string;
  age: number;
}

/** Направление от кончиков палочек к рукояткам (вверх-вправо). */
const STICK_DIR = normalize(0.42, -0.91);
const STICK_LEN = 560;
const FX_LIFE = 0.8;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;
  private colorCache = new WeakMap<Grain, GrainColors>();
  private floats: FloatFx[] = [];
  private rings: RingFx[] = [];
  private shake = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Мир вписываем целиком, с небольшим полем; сверху оставляем место под HUD.
    const hudSpace = 56;
    const pad = 8;
    this.scale = Math.min((w - pad * 2) / WORLD_W, (h - hudSpace - pad) / WORLD_H);
    this.offsetX = (w - WORLD_W * this.scale) / 2;
    this.offsetY = hudSpace + (h - hudSpace - pad - WORLD_H * this.scale) / 2;
  }

  /** Экранные CSS-пиксели → координаты мира. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.offsetX) / this.scale,
      y: (clientY - this.offsetY) / this.scale,
    };
  }

  handleEvents(events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'sorted') {
        this.floats.push({ x: e.x, y: e.y - 20, text: '+1', color: '#2e8b57', age: 0 });
        this.rings.push({ x: e.x, y: e.y, color: '46, 139, 87', age: 0 });
      } else if (e.type === 'wrong') {
        this.floats.push({ x: e.x, y: e.y - 20, text: '✕', color: '#c0392b', age: 0 });
        this.shake = 0.25;
      } else if (e.type === 'slipped') {
        this.rings.push({ x: e.x, y: e.y, color: '192, 57, 43', age: 0 });
      }
    }
  }

  draw(session: Session | null, dt: number): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#e9e4da');
    bg.addColorStop(1, '#d8d1c3');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    if (!session) return;

    this.shake = Math.max(0, this.shake - dt);
    const s = this.shake > 0 ? Math.sin(this.shake * 80) * 6 * this.shake : 0;
    ctx.setTransform(
      this.scale * this.dpr,
      0,
      0,
      this.scale * this.dpr,
      (this.offsetX + s) * this.dpr,
      this.offsetY * this.dpr,
    );

    this.drawTable();
    for (const tray of session.trays) this.drawTray(tray, session);

    const scale = session.config.sizeScale;
    for (const g of session.grains) {
      if (g.state === 'sorted') this.drawGrain(g, scale);
    }
    for (const g of session.grains) {
      if (g.state === 'free') this.drawGrain(g, scale);
    }
    const held = session.heldGrain;
    if (held) this.drawGrain(held, scale * 1.05, true);

    this.drawChopsticks(session);
    this.drawFx(dt);
  }

  // ——— стол и лотки ———

  private drawTable(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(60, 45, 30, 0.18)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, 6, 6, WORLD_W - 12, TABLE_BOTTOM - 6, 28);
    ctx.fillStyle = '#fbfaf7';
    ctx.fill();
    ctx.restore();
  }

  private drawTray(tray: Tray, session: Session): void {
    const ctx = this.ctx;
    const { x, y, w, h } = tray;
    const full = tray.count >= tray.total;

    ctx.save();
    ctx.shadowColor = 'rgba(60, 40, 20, 0.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    roundRect(ctx, x, y, w, h, 22);
    const wood = ctx.createLinearGradient(x, y, x, y + h);
    wood.addColorStop(0, '#c99a62');
    wood.addColorStop(1, '#a8743f');
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x + 9, y + 9, w - 18, h - 18, 15);
    ctx.fillStyle = full ? '#e8f4e8' : '#efe3cf';
    ctx.fill();

    // Подсветка лотка, над которым сейчас зерно в палочках.
    const held = session.heldGrain;
    if (held && held.x >= x && held.x <= x + w && held.y >= y && held.y <= y + h) {
      roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 18);
      ctx.lineWidth = 5;
      ctx.strokeStyle = held.kind === tray.kind ? 'rgba(46,139,87,0.85)' : 'rgba(192,57,43,0.85)';
      ctx.stroke();
    }

    // Подпись: образец зерна и счётчик.
    const kind = GRAIN_KINDS[tray.kind];
    const sx = x + 30;
    const sy = y + 28;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-0.5);
    this.drawGrainShape(kind, this.kindColors(kind, 0), 1.3, false);
    ctx.restore();

    ctx.fillStyle = '#5b3d22';
    ctx.font = '600 24px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${tray.count}/${tray.total}`, x + w - 18, y + 29);
  }

  // ——— зёрна ———

  private kindColors(kind: GrainKind, tint: number): GrainColors {
    const l = Math.max(4, Math.min(96, kind.light + tint));
    const markLight = kind.light > 60 ? Math.max(10, l - 45) : Math.min(95, l + 50);
    return {
      base: `hsl(${kind.hue} ${kind.sat}% ${l}%)`,
      light: `hsl(${kind.hue} ${Math.max(0, kind.sat - 10)}% ${Math.min(98, l + 12)}%)`,
      dark: `hsl(${kind.hue} ${kind.sat}% ${Math.max(0, l - 22)}%)`,
      mark: `hsl(${kind.hue} ${kind.sat}% ${markLight}%)`,
    };
  }

  private colorsFor(g: Grain): GrainColors {
    let c = this.colorCache.get(g);
    if (!c) {
      c = this.kindColors(GRAIN_KINDS[g.kind], g.tint);
      this.colorCache.set(g, c);
    }
    return c;
  }

  private drawGrain(g: Grain, scale: number, lifted = false): void {
    const ctx = this.ctx;
    const kind = GRAIN_KINDS[g.kind];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);
    if (lifted) {
      // Тень зерна, поднятого над столом.
      ctx.save();
      ctx.translate(6, 9);
      ctx.globalAlpha = 0.18;
      this.drawGrainShape(kind, { base: '#000', light: '#000', dark: '#000', mark: '#000' }, scale, false);
      ctx.restore();
    }
    this.drawGrainShape(kind, this.colorsFor(g), scale, true);
    ctx.restore();
  }

  private drawGrainShape(kind: GrainKind, c: GrainColors, scale: number, outline: boolean): void {
    const ctx = this.ctx;
    const L = (kind.length * scale) / 2;
    const W = (kind.width * scale) / 2;

    ctx.beginPath();
    switch (kind.shape) {
      case 'rice':
      case 'bean':
        ctx.ellipse(0, 0, L, W, 0, 0, Math.PI * 2);
        break;
      case 'round':
      case 'lentil':
        ctx.arc(0, 0, L, 0, Math.PI * 2);
        break;
      case 'buckwheat': {
        const pts = [0, 1, 2].map((i) => {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
          return [Math.cos(a) * L, Math.sin(a) * L];
        });
        const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const m0 = mid(pts[0], pts[1]);
        ctx.moveTo(m0[0], m0[1]);
        for (let i = 1; i <= 3; i++) {
          const p = pts[i % 3];
          const m = mid(p, pts[(i + 1) % 3]);
          ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
        }
        ctx.closePath();
        break;
      }
    }
    ctx.fillStyle = c.base;
    ctx.fill();
    if (outline) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = c.dark;
      ctx.stroke();
    }

    // Блик и детали.
    ctx.fillStyle = c.light;
    ctx.beginPath();
    switch (kind.shape) {
      case 'rice':
        ctx.ellipse(-L * 0.15, -W * 0.3, L * 0.55, W * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'round':
        ctx.arc(-L * 0.3, -L * 0.3, L * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'lentil':
        ctx.arc(0, 0, L * 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'bean':
        ctx.ellipse(-L * 0.2, -W * 0.35, L * 0.5, W * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = c.mark;
        ctx.ellipse(0, W * 0.72, L * 0.22, W * 0.14, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'buckwheat':
        ctx.arc(0, -L * 0.15, L * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  // ——— палочки ———

  private drawChopsticks(session: Session): void {
    const c = session.chop;
    if (!c.pressed && !c.hover) return;
    const held = session.heldGrain;
    const grainW = held ? GRAIN_KINDS[held.kind].width * session.config.sizeScale : 0;
    // Раскрытые палочки шире зерна, сжатые — ровно обхватывают его.
    const openGap = 30;
    const closedGap = held ? grainW + 3 : 4;
    const gap = openGap + (closedGap - openGap) * c.pinch;

    const px = -STICK_DIR.y;
    const py = STICK_DIR.x;
    const handleGap = gap * 0.6 + 26;
    const alpha = c.pressed ? 1 : 0.55;

    for (const side of [-1, 1]) {
      const tipX = c.x + px * side * (gap / 2);
      const tipY = c.y + py * side * (gap / 2);
      const endX = c.x + STICK_DIR.x * STICK_LEN + px * side * (handleGap / 2);
      const endY = c.y + STICK_DIR.y * STICK_LEN + py * side * (handleGap / 2);
      this.drawStick(tipX, tipY, endX, endY, alpha);
    }
  }

  private drawStick(x0: number, y0: number, x1: number, y1: number, alpha: number): void {
    const ctx = this.ctx;
    const d = normalize(x1 - x0, y1 - y0);
    const nx = -d.y;
    const ny = d.x;
    const tipW = 3;
    const endW = 8;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 6;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * tipW, y0 + ny * tipW);
    ctx.lineTo(x1 + nx * endW, y1 + ny * endW);
    ctx.lineTo(x1 - nx * endW, y1 - ny * endW);
    ctx.lineTo(x0 - nx * tipW, y0 - ny * tipW);
    ctx.closePath();
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, '#3a2414');
    grad.addColorStop(0.75, '#2a1a10');
    grad.addColorStop(0.76, '#8b1e1e');
    grad.addColorStop(1, '#6e1414');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Блик вдоль палочки.
    ctx.save();
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * 1 + d.x * 12, y0 + ny * 1 + d.y * 12);
    ctx.lineTo(x1 + nx * 3, y1 + ny * 3);
    ctx.stroke();
    ctx.restore();
  }

  // ——— эффекты ———

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    for (const r of this.rings) {
      r.age += dt;
      const t = r.age / FX_LIFE;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + t * 40, 0, Math.PI * 2);
      ctx.lineWidth = 4 * (1 - t);
      ctx.strokeStyle = `rgba(${r.color}, ${1 - t})`;
      ctx.stroke();
    }
    this.rings = this.rings.filter((r) => r.age < FX_LIFE);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    for (const f of this.floats) {
      f.age += dt;
      const t = f.age / FX_LIFE;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - t * 50);
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.age < FX_LIFE);
  }

  clearFx(): void {
    this.floats = [];
    this.rings = [];
    this.shake = 0;
  }
}

function normalize(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
