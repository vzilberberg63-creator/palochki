import type { LevelConfig } from './level';
import { Pusher, applyPushers, resolveCollisions, stepPhysics } from './physics';
import { Grain, Session, StickMask } from './session';
import { Layout, Rect } from './world';

/**
 * Режим «Кучки» — как в ролике: палочки прижаты к столу и работают как лопатка.
 * Зёрна не берут по одному, а отделяют от общей кучи и целиком сталкивают в копилку.
 *
 * - Нажатие опускает палочки на стол, движение сгребает зёрна. Отпустили — палочки поднялись.
 * - Палочки опускаются по отдельности: на мыши левая кнопка — левая палочка, правая — правая.
 *   Одна палочка — узкий «нож», им отделяют зёрна от кучи; обе — совок, им сталкивают кучку.
 *   На пальце опускаются обе.
 * - Лопатка всегда развёрнута поперёк движения и чуть вогнута, чтобы кучка не расползалась.
 * - Зерно нужного вида, заехавшее в свою копилку, остаётся там насовсем.
 * - Чужое зерно в копилке — ошибка; пока его не убрали, уровень не пройден.
 *   Убрать можно лопаткой или нажатием на него: палочки выбросят зерно обратно на стол.
 */

/** Толщина лопатки (радиус капсулы). */
const BLADE_RADIUS = 5;
/** Насколько края лопатки загнуты вперёд, доля полуширины: лопатка работает как совок. */
const BLADE_CURVE = 0.8;
/** Зерно, которого коснулась лопатка, почти полностью перенимает её скорость и не разъезжается вбок. */
const BLADE_CARRY = 0.9;
/** Шаг, с которым лопатка проходит путь за кадр, чтобы быстрым движением не «проскочить» сквозь зёрна. */
const SUBSTEP = 5;
const MAX_SUBSTEPS = 14;
/** Как быстро лопатка разворачивается за движением (чем больше путь, тем быстрее). */
const TURN_DISTANCE = 24;
/**
 * Первые единицы пути после касания лопатка сразу встаёт поперёк движения:
 * иначе она начинает мазок боком и раскидывает кучку.
 */
const SNAP_DISTANCE = 14;
/** На каком расстоянии от зерна нажатие считается нажатием на него. */
const EJECT_RADIUS = 22;
/** С какой скоростью выброшенное зерно катится к куче. */
const EJECT_SPEED = 250;
/** Слабый отброс: лопатка должна вести кучку, а не разбрасывать её. */
const BLADE_FLING = 8;
const BOTH: StickMask = { left: true, right: true };

export class HeapSession extends Session {
  /** Чужие зёрна, которые сейчас лежат в копилках. */
  readonly intruders = new Set<number>();
  /** Все чужие зёрна, хоть раз заехавшие в копилку: ошибка считается один раз на зерно. */
  private readonly everIntruded = new Set<number>();
  /** Путь, пройденный с момента касания стола. */
  private strokeDist = 0;
  /**
   * Какой стороне лопатки соответствует левая палочка (−1 или +1). Определяется в начале мазка
   * по экрану и не меняется до конца, чтобы палочки не менялись местами, пока лопатка поворачивается.
   */
  private leftSide: -1 | 1 = -1;
  /** Какие кнопки сейчас зажаты (левая/правая палочка). */
  private mask: StickMask = { left: false, right: false };

  constructor(config: LevelConfig, layout: Layout) {
    super(config, layout);
    // Копилки доходят до самого края стола: кучку прижимают к бортику, и она должна оказаться внутри.
    const t = layout.table;
    for (const tray of this.trays) {
      if (layout.trayDirection === 'row') tray.h = t.maxY - tray.y;
      else tray.w = t.maxX - tray.x;
    }
  }

  override pointerDown(x: number, y: number, touch = false, sticks: StickMask = BOTH): void {
    if (this.status !== 'playing') return;
    const c = this.chop;
    c.pointerX = x;
    c.pointerY = y;
    c.touch = touch;
    c.lift = 0;
    this.updateTip(0);
    // Стук кончиков о стол.
    this.events.push({ type: 'grab', x: c.x, y: c.y });
    // Нажатие на чужое зерно в копилке — выбрасываем его, а не начинаем сгребать.
    if (this.ejectAt(c.x, c.y, touch)) return;
    this.strokeDist = 0;
    this.leftSide = this.screenLeftSide();
    this.applySticks(sticks);
  }

  /**
   * Нажали или отпустили одну из кнопок посреди мазка (на мыши это приходит как движение
   * с другим набором кнопок). Отпущены обе — палочки поднялись.
   */
  setSticks(sticks: StickMask): void {
    if (this.status !== 'playing') return;
    const c = this.chop;
    if (!sticks.left && !sticks.right) {
      this.pointerUp();
      return;
    }
    const wasLeft = c.pressed && (this.leftSide < 0 ? c.lowNeg : c.lowPos);
    const wasRight = c.pressed && (this.leftSide < 0 ? c.lowPos : c.lowNeg);
    if (!c.pressed) {
      this.strokeDist = 0;
      this.leftSide = this.screenLeftSide();
    }
    // Каждая опущенная палочка стучит о стол.
    if ((sticks.left && !wasLeft) || (sticks.right && !wasRight)) {
      this.events.push({ type: 'grab', x: c.x, y: c.y });
    }
    this.applySticks(sticks);
  }

  private applySticks(sticks: StickMask): void {
    this.mask = { ...sticks };
    const c = this.chop;
    const leftNeg = this.leftSide < 0;
    c.lowNeg = leftNeg ? sticks.left : sticks.right;
    c.lowPos = leftNeg ? sticks.right : sticks.left;
    c.pressed = c.lowNeg || c.lowPos;
  }

  /** Какая сторона лопатки сейчас левее на экране. */
  private screenLeftSide(): -1 | 1 {
    const bx = -this.chop.bladeDirY;
    const by = this.chop.bladeDirX;
    if (Math.abs(bx) > 0.01) return bx > 0 ? -1 : 1;
    // Лопатка стоит вертикально: «левой» считаем верхнюю палочку.
    return by > 0 ? -1 : 1;
  }

  /** Выбросить ближайшее к точке чужое зерно из копилки обратно на стол, к куче. */
  private ejectAt(x: number, y: number, touch: boolean): boolean {
    const radius = EJECT_RADIUS + (touch ? 10 : 0);
    let best: Grain | null = null;
    let bestD = Infinity;
    for (const id of this.intruders) {
      const g = this.grains[id];
      const d = Math.hypot(g.x - x, g.y - y) - g.r;
      if (d <= radius && d < bestD) {
        best = g;
        bestD = d;
      }
    }
    if (!best) return false;
    const tray = this.trays.find((t) => insideZone(t, best!));
    const pc = this.layout.pileCenter;
    if (tray) {
      // Ставим сразу за краем копилки со стороны кучи.
      if (this.layout.trayDirection === 'row') best.y = tray.y - best.r - 2;
      else best.x = tray.x - best.r - 2;
    }
    const dx = pc.x - best.x;
    const dy = pc.y - best.y;
    const d = Math.hypot(dx, dy) || 1;
    best.vx = (dx / d) * EJECT_SPEED;
    best.vy = (dy / d) * EJECT_SPEED;
    best.spin = 8;
    this.intruders.delete(best.id);
    this.events.push({ type: 'slipped', x: best.x, y: best.y });
    return true;
  }

  override pointerUp(): void {
    const c = this.chop;
    c.pressed = false;
    c.lowNeg = false;
    c.lowPos = false;
    this.rakeActivity = 0;
  }

  /** Звёзды: ошибок допускается больше, чем в «По зёрнышку», — при сгребании чужие зёрна неизбежно цепляются. */
  override stars(): number {
    if (this.status !== 'won') return 0;
    const limit = this.config.timeLimit;
    const left = limit === null ? 1 : (this.timeLeft ?? 0) / limit;
    const stars = 1 + (this.mistakes <= 3 ? 1 : 0) + (left >= 0.3 ? 1 : 0);
    return this.continued ? Math.min(2, stars) : stars;
  }

  override update(dt: number): void {
    if (this.status !== 'playing') return;
    this.advanceTime(dt);

    const c = this.chop;
    const prevX = c.x;
    const prevY = c.y;
    this.updateTip(dt);
    c.pinch += ((c.pressed ? 1 : 0) - c.pinch) * Math.min(1, dt * 18);

    const mx = c.x - prevX;
    const my = c.y - prevY;
    const dist = Math.hypot(mx, my);
    const snap = c.pressed && this.strokeDist < SNAP_DISTANCE;
    this.turnBlade(mx, my, dist, snap);
    // Пока лопатка встаёт поперёк нового мазка, заново решаем, какая палочка левая:
    // по направлению прошлого мазка левая кнопка могла бы достаться правой палочке.
    if (snap && dist >= 0.5) {
      this.leftSide = this.screenLeftSide();
      this.applySticks(this.mask);
    }
    if (c.pressed) this.strokeDist += dist;

    const free = this.freeGrains();
    let contacts = 0;
    // В начале мазка лопатка ещё не знает направления: опускаем её на стол, когда оно ясно.
    if (c.pressed && dist > 0 && !(snap && this.strokeDist < SNAP_DISTANCE)) {
      const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / SUBSTEP)));
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        contacts += applyPushers(free, this.bladeAt(prevX + mx * k, prevY + my * k), BLADE_FLING, BLADE_CARRY);
        resolveCollisions(free);
      }
    } else if (c.pressed) {
      // Лопатка стоит на месте, но всё равно не пускает зёрна сквозь себя.
      applyPushers(free, this.bladeAt(c.x, c.y), 0);
    }

    stepPhysics(free, dt, { damping: this.config.damping, bounds: this.bounds, iterations: 3 });

    const speed = Math.hypot(c.vx, c.vy);
    const target = c.pressed ? Math.min(1, contacts / 8) * Math.min(1, speed / 400) : 0;
    this.rakeActivity += (target - this.rakeActivity) * Math.min(1, dt * 12);

    this.updateZones();
    if (this.status === 'playing') this.checkTimeout();
  }

  /**
   * Отрезки лопатки в точке (x, y) для опущенных палочек. Каждая палочка — половина совка:
   * от середины кромки до своего края, загнутого вперёд.
   */
  bladeAt(x: number, y: number): Pusher[] {
    const c = this.chop;
    const fx = c.bladeDirX;
    const fy = c.bladeDirY;
    const bx = -fy;
    const by = fx;
    const h = c.bladeHalf;
    const inner = h * 0.45;
    const curve = h * BLADE_CURVE;
    const v = { r: BLADE_RADIUS, vx: c.vx, vy: c.vy };
    const out: Pusher[] = [];
    for (const side of [-1, 1] as const) {
      if (!(side < 0 ? c.lowNeg : c.lowPos)) continue;
      const ix = x + bx * inner * side;
      const iy = y + by * inner * side;
      out.push({ x, y, x2: ix, y2: iy, ...v });
      out.push({ x: ix, y: iy, x2: x + bx * h * side + fx * curve, y2: y + by * h * side + fy * curve, ...v });
    }
    return out;
  }

  /** Лопатка плавно поворачивается поперёк направления движения. */
  private turnBlade(mx: number, my: number, dist: number, snap: boolean): void {
    if (dist < 0.5) return;
    if (snap) {
      this.chop.bladeDirX = mx / dist;
      this.chop.bladeDirY = my / dist;
      return;
    }
    const c = this.chop;
    // Поворачиваем по углу: смешивание векторов не справляется с разворотом на 180°.
    const cur = Math.atan2(c.bladeDirY, c.bladeDirX);
    let diff = Math.atan2(my, mx) - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const angle = cur + diff * Math.min(1, dist / TURN_DISTANCE);
    c.bladeDirX = Math.cos(angle);
    c.bladeDirY = Math.sin(angle);
  }

  private updateZones(): void {
    for (const g of this.grains) {
      if (g.state !== 'free') continue;
      const tray = this.trays.find((t) => insideZone(t, g));
      if (!tray) {
        this.intruders.delete(g.id);
        continue;
      }
      if (tray.kind === g.kind) {
        g.state = 'sorted';
        g.vx = g.vy = g.spin = 0;
        tray.count++;
        this.sortedCount++;
        this.intruders.delete(g.id);
        this.addToCombo(g);
      } else if (!this.intruders.has(g.id)) {
        this.intruders.add(g.id);
        this.breakCombo();
        // Ошибка — одна на зерно, даже если оно заезжает в копилку снова.
        if (!this.everIntruded.has(g.id)) {
          this.everIntruded.add(g.id);
          this.mistakes++;
          this.events.push({ type: 'wrong', x: g.x, y: g.y });
        }
      }
    }
    if (this.sortedCount >= this.totalTargets && this.intruders.size === 0 && this.status === 'playing') {
      this.status = 'won';
      this.rakeActivity = 0;
      this.events.push({ type: 'won' });
    }
  }
}

/** Зерно считается в копилке, когда его центр зашёл внутрь, а не только краем. */
function insideZone(r: Rect, g: Grain): boolean {
  const m = g.r * 0.6;
  return g.x >= r.x + m && g.x <= r.x + r.w - m && g.y >= r.y + m && g.y <= r.y + r.h - m;
}
