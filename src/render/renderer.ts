import { GRAIN_KINDS, GrainKind } from '../core/grains';
import { COMBO_MIN_SHOWN, COMBO_WINDOW, comboMultiplier } from '../core/session';
import type { GameEvent, Grain, Session, Tray } from '../core/session';
import { HeapSession } from '../core/heap';
import { t } from '../i18n';
import { ChopstickSkin, SKINS } from '../core/skins';
import { Layout, SQUARE } from '../core/world';

/** Место сверху под HUD и поле по краям, в CSS-пикселях. */
export const HUD_SPACE = 56;
export const SCREEN_PAD = 8;
const MAX_SCALE = 1;

/** Область экрана, в которую вписывается мир. */
export function viewportArea(): { w: number; h: number } {
  return {
    w: window.innerWidth - SCREEN_PAD * 2,
    h: window.innerHeight - HUD_SPACE - SCREEN_PAD,
  };
}

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
  /** Размер шрифта в единицах мира. */
  size: number;
}

interface RingFx {
  x: number;
  y: number;
  color: string;
  age: number;
}

/** Направление от кончиков палочек к рукояткам (вверх-вправо). */
const STICK_DIR = normalize(0.42, -0.91);
const STICK_LEN = 520;
/** В «Кучках» палочки лежат почти горизонтально над столом, видна только их часть. */
const BLADE_STICK_LEN = 420;
const FX_LIFE = 0.8;
/** С этого момента время «горит»: полоска красная и пульсирует, часы тикают. */
export const URGENT_SECONDS = 10;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const COMBO_COLOR = '#c98a12';
const COMBO_COLOR_LIGHT = '#f2c14e';

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
  private comboPulse = 0;
  private comboAlpha = 0;
  private skin: ChopstickSkin = SKINS[0];
  private layout: Layout = SQUARE;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  setSkin(skin: ChopstickSkin): void {
    this.skin = skin;
  }

  /** Раскладка текущего уровня; масштаб пересчитывается под неё. */
  setLayout(layout: Layout): void {
    this.layout = layout;
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
    const { w: lw, h: lh } = this.layout;
    const area = viewportArea();
    // На большом экране не раздуваем зёрна больше натурального размера мира.
    this.scale = Math.min(area.w / lw, area.h / lh, MAX_SCALE);
    this.offsetX = (w - lw * this.scale) / 2;
    this.offsetY = HUD_SPACE + (area.h - lh * this.scale) / 2;
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
        const boosted = e.points > 10;
        this.floats.push({
          x: e.x,
          y: e.y - 20,
          text: `+${e.points}`,
          color: boosted ? COMBO_COLOR : '#2e8b57',
          age: 0,
          size: boosted ? 38 : 32,
        });
        this.rings.push({ x: e.x, y: e.y, color: boosted ? '201, 138, 18' : '46, 139, 87', age: 0 });
      } else if (e.type === 'combo') {
        this.floats.push({ x: e.x, y: e.y - 70, text: `×${e.multiplier}!`, color: COMBO_COLOR, age: 0, size: 56 });
        this.rings.push({ x: e.x, y: e.y, color: '201, 138, 18', age: -0.1 });
        this.comboPulse = 1;
      } else if (e.type === 'timeBonus') {
        this.floats.push({ x: e.x + 60, y: e.y - 40, text: t().timeBonus(e.seconds), color: '#2f6fb0', age: 0, size: 30 });
      } else if (e.type === 'wrong') {
        this.floats.push({ x: e.x, y: e.y - 20, text: '✕', color: '#c0392b', age: 0, size: 34 });
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
    const heap = session instanceof HeapSession ? session : null;
    for (const tray of session.trays) {
      if (heap) this.drawZone(tray);
      else this.drawTray(tray, session);
    }

    const scale = session.config.sizeScale;
    for (const g of session.grains) {
      if (g.state === 'sorted') this.drawGrain(g, scale);
    }
    for (const g of session.grains) {
      if (g.state === 'free') this.drawGrain(g, scale);
    }
    const held = session.heldGrain;
    if (held) this.drawGrain(held, scale * 1.05, true);
    if (heap) this.drawIntruders(heap);

    this.drawTimeBar(session);
    this.drawCombo(session, dt);
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
    const t = this.layout.table;
    roundRect(ctx, t.minX, t.minY, t.maxX - t.minX, t.maxY - t.minY, 28);
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

  /** «Кучки»: копилка — плоский коврик на столе, зёрна заезжают на него. */
  private drawZone(tray: Tray): void {
    const ctx = this.ctx;
    const { x, y, w, h } = tray;
    const full = tray.count >= tray.total;
    roundRect(ctx, x, y, w, h, 18);
    ctx.fillStyle = full ? 'rgba(90, 158, 111, 0.16)' : 'rgba(201, 154, 98, 0.16)';
    ctx.fill();
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = full ? 'rgba(46, 139, 87, 0.7)' : 'rgba(150, 105, 55, 0.55)';
    ctx.stroke();
    ctx.restore();

    const kind = GRAIN_KINDS[tray.kind];
    ctx.save();
    ctx.translate(x + 30, y + 28);
    ctx.rotate(-0.5);
    this.drawGrainShape(kind, this.kindColors(kind, 0), 1.3, false);
    ctx.restore();
    ctx.fillStyle = full ? '#2e8b57' : '#7a5530';
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${tray.count}/${tray.total}`, x + w - 18, y + 29);
  }

  /** Чужие зёрна в копилках обведены пульсирующим красным кругом. */
  private drawIntruders(session: HeapSession): void {
    if (session.intruders.size === 0) return;
    const ctx = this.ctx;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 160);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(192, 57, 43, ${pulse})`;
    for (const id of session.intruders) {
      const g = session.grains[id];
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * «Кучки»: палочки сведены лопаткой. Кончики — на краях лопатки, рукоятки тянутся назад,
   * под кончиками — тень прижатой кромки.
   */
  private drawBlade(session: Session): void {
    const c = session.chop;
    const fx = c.bladeDirX;
    const fy = c.bladeDirY;
    const bx = -fy;
    const by = fx;
    const h = c.bladeHalf;
    const curve = h * 0.8;
    const ctx = this.ctx;

    // Под каждой опущенной палочкой — тень прижатой кромки (её половина совка).
    for (const side of [-1, 1] as const) {
      if (!(side < 0 ? c.lowNeg : c.lowPos)) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(40, 25, 10, 0.18)';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + bx * h * 0.45 * side, c.y + by * h * 0.45 * side);
      ctx.lineTo(c.x + bx * h * side + fx * curve, c.y + by * h * side + fy * curve);
      ctx.stroke();
      ctx.restore();
    }

    for (const side of [-1, 1] as const) {
      // Кончик на краю лопатки; палочки тянутся назад к руке и сходятся, но не перекрещиваются.
      // Поднятая палочка полупрозрачная и чуть приподнята — сдвинута к руке.
      const down = side < 0 ? c.lowNeg : c.lowPos;
      const lift = down ? 0 : 10;
      const tipX = c.x + bx * side * h + fx * (curve - lift);
      const tipY = c.y + by * side * h + fy * (curve - lift);
      const endX = c.x - fx * BLADE_STICK_LEN + bx * side * h * 0.3;
      const endY = c.y - fy * BLADE_STICK_LEN + by * side * h * 0.3;
      drawStick(ctx, tipX, tipY, endX, endY, down ? 1 : 0.5, this.skin);
    }
  }

  private drawChopsticks(session: Session): void {
    const c = session.chop;
    if (!c.pressed && !c.hover) return;
    if (session instanceof HeapSession) {
      this.drawBlade(session);
      return;
    }
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
      drawStick(this.ctx, tipX, tipY, endX, endY, alpha, this.skin);
    }
  }

  // ——— эффекты ———

  private drawFx(dt: number): void {
    const ctx = this.ctx;
    for (const r of this.rings) {
      r.age += dt;
      if (r.age < 0) continue;
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
    for (const f of this.floats) {
      f.age += dt;
      const t = f.age / FX_LIFE;
      ctx.font = `800 ${f.size}px ${FONT}`;
      ctx.globalAlpha = Math.max(0, 1 - t);
      // Светлая обводка, чтобы цифры читались поверх тёмных зёрен.
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255, 253, 248, 0.9)';
      ctx.strokeText(f.text, f.x, f.y - t * 50);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - t * 50);
    }
    ctx.globalAlpha = 1;
    this.floats = this.floats.filter((f) => f.age < FX_LIFE);
  }

  /** Полоска времени вдоль верхнего края стола: убывает, краснеет и пульсирует в конце. */
  private drawTimeBar(session: Session): void {
    const limit = session.config.timeLimit;
    const left = session.timeLeft;
    if (limit === null || left === null) return;
    const ctx = this.ctx;
    const tb = this.layout.table;
    const x = tb.minX + 18;
    const y = tb.minY + 12;
    const w = tb.maxX - tb.minX - 36;
    const h = 9;
    const frac = Math.max(0, Math.min(1, left / (limit + session.bonusTime)));

    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(59, 42, 26, 0.1)';
    ctx.fill();
    if (frac <= 0) return;

    const urgent = left <= URGENT_SECONDS;
    const color = urgent ? '#d0533f' : frac > 0.5 ? '#5a9e6f' : '#d9a63a';
    ctx.save();
    if (urgent) {
      // Пульс раз в секунду, в такт тиканью.
      const phase = left % 1;
      ctx.globalAlpha = 0.65 + 0.35 * phase;
    }
    roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Плашка комбо в углу стола: множитель, длина серии и убывающая полоска окна. */
  private drawCombo(session: Session, dt: number): void {
    this.comboPulse = Math.max(0, this.comboPulse - dt * 3);
    const visible = session.combo >= COMBO_MIN_SHOWN && session.status === 'playing';
    this.comboAlpha += ((visible ? 1 : 0) - this.comboAlpha) * Math.min(1, dt * 10);
    if (this.comboAlpha < 0.02) return;

    const ctx = this.ctx;
    const tb = this.layout.table;
    const w = 230;
    const h = 64;
    const x = tb.minX + 18;
    const y = tb.minY + 30;
    const scale = 1 + this.comboPulse * 0.12;

    ctx.save();
    ctx.globalAlpha = this.comboAlpha;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);

    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fillStyle = 'rgba(59, 42, 26, 0.9)';
    ctx.fill();

    const mult = comboMultiplier(Math.max(session.combo, 1));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = COMBO_COLOR_LIGHT;
    ctx.font = `800 34px ${FONT}`;
    ctx.fillText(`×${mult}`, 16, 28);
    ctx.fillStyle = '#fffdf8';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(`${t().combo} ${session.combo}`, 82, 28);

    // Полоска: сколько ещё ждёт серия.
    const frac = Math.max(0, session.comboTimer / COMBO_WINDOW);
    roundRect(ctx, 16, h - 14, w - 32, 6, 3);
    ctx.fillStyle = 'rgba(255, 253, 248, 0.2)';
    ctx.fill();
    if (frac > 0) {
      roundRect(ctx, 16, h - 14, (w - 32) * frac, 6, 3);
      ctx.fillStyle = frac < 0.3 ? '#e2725b' : COMBO_COLOR_LIGHT;
      ctx.fill();
    }
    ctx.restore();
  }

  clearFx(): void {
    this.floats = [];
    this.rings = [];
    this.shake = 0;
    this.comboPulse = 0;
    this.comboAlpha = 0;
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

/**
 * Одна палочка по стилю: от кончика (x0, y0) к рукоятке (x1, y1).
 * Используется и в игре, и в превью магазина.
 */
export function drawStick(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alpha: number,
  skin: ChopstickSkin,
  widthScale = 1,
): void {
  const d = normalize(x1 - x0, y1 - y0);
  const nx = -d.y;
  const ny = d.x;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const tipW = skin.tipWidth * widthScale;
  const endW = skin.endWidth * widthScale;
  const at = (f: number) => ({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, w: tipW + (endW - tipW) * f });

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + nx * tipW, y0 + ny * tipW);
    ctx.lineTo(x1 + nx * endW, y1 + ny * endW);
    ctx.lineTo(x1 - nx * endW, y1 - ny * endW);
    ctx.lineTo(x0 - nx * tipW, y0 - ny * tipW);
    ctx.closePath();
  };

  // Тело с тенью.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 10 * widthScale;
  ctx.shadowOffsetX = 6 * widthScale;
  ctx.shadowOffsetY = 10 * widthScale;
  outline();
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [pos, color] of skin.stops) grad.addColorStop(pos, color);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Узоры и кольца рисуем только внутри силуэта палочки.
  ctx.save();
  ctx.globalAlpha = alpha;
  outline();
  ctx.clip();

  const ring = (f: number, thickness: number, color: string) => {
    const a = at(f - thickness / len / 2);
    const b = at(f + thickness / len / 2);
    ctx.beginPath();
    ctx.moveTo(a.x + nx * (a.w + 1), a.y + ny * (a.w + 1));
    ctx.lineTo(b.x + nx * (b.w + 1), b.y + ny * (b.w + 1));
    ctx.lineTo(b.x - nx * (b.w + 1), b.y - ny * (b.w + 1));
    ctx.lineTo(a.x - nx * (a.w + 1), a.y - ny * (a.w + 1));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  for (const [f, color] of skin.bands ?? []) ring(f, 5 * widthScale, color);

  const pattern = skin.pattern;
  if (pattern?.kind === 'nodes') {
    // Коленца бамбука: тёмное кольцо и светлый край рядом.
    for (const f of [0.28, 0.52, 0.76]) {
      ring(f, 3 * widthScale, pattern.color);
      ring(f + 0.012, 2 * widthScale, 'rgba(255, 240, 200, 0.5)');
    }
  } else if (pattern?.kind === 'stripes') {
    // Насечки на рукоятке, чтобы палочки не скользили в руке.
    for (let f = 0.72; f < 0.98; f += 0.022) ring(f, 1.6 * widthScale, pattern.color);
  } else if (pattern?.kind === 'petals') {
    // Лепестки сакуры вдоль рукоятки, попеременно по краям.
    ctx.fillStyle = pattern.color;
    [0.36, 0.5, 0.64, 0.78, 0.92].forEach((f, i) => {
      const p = at(f);
      const side = i % 2 === 0 ? 0.35 : -0.35;
      const cx = p.x + nx * p.w * side;
      const cy = p.y + ny * p.w * side;
      const r = p.w * 0.38;
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * r * 0.7, cy + Math.sin(ang) * r * 0.7, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  ctx.restore();

  // Блик вдоль палочки: у металла ярче и с отражением на другой стороне.
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha * (0.2 + skin.sheen * 0.5);
  ctx.lineWidth = (1.2 + skin.sheen * 1.2) * widthScale;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * tipW * 0.35 + d.x * 12 * widthScale, y0 + ny * tipW * 0.35 + d.y * 12 * widthScale);
  ctx.lineTo(x1 + nx * endW * 0.4, y1 + ny * endW * 0.4);
  ctx.stroke();
  if (skin.sheen >= 0.7) {
    ctx.globalAlpha = alpha * skin.sheen * 0.2;
    ctx.beginPath();
    ctx.moveTo(x0 - nx * tipW * 0.5 + d.x * 20 * widthScale, y0 - ny * tipW * 0.5 + d.y * 20 * widthScale);
    ctx.lineTo(x1 - nx * endW * 0.55, y1 - ny * endW * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

/** Превью пары палочек для карточки магазина. Рисует под размер canvas в CSS-пикселях. */
export function drawChopsticksPreview(canvas: HTMLCanvasElement, skin: ChopstickSkin): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 90;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w, h) / 90;
  // Кончики внизу слева, рукоятки вверху справа, палочки чуть сходятся к кончикам.
  drawStick(ctx, w * 0.16, h * 0.86, w * 0.9, h * 0.1, 1, skin, s * 1.15);
  drawStick(ctx, w * 0.1, h * 0.78, w * 0.8, h * 0.02 + 2, 1, skin, s * 1.15);
}
