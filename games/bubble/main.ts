import { SCALE, Synth } from '../shared/audio';
import { Game, startShell } from '../shared/shell';
import { Stage, roundRect, runLoop } from '../shared/stage';
import { BIRD_MASS, Bird, BirdKind, BubbleModel, HALF_LEN, PIVOT, WORLD_H, WORLD_W } from './bubble';

const TEXTS = (ru: boolean) =>
  ru
    ? {
        title: 'Пузырёк',
        tagline: 'Птицам — доска, вам — уровень.',
        howTo: 'На доску садятся птицы и кренят её. Жмите слева или справа — грузик поедет в ту сторону. Держите пузырёк между отметками.',
        play: 'Держать уровень',
        again: 'Ещё раз',
        resume: 'Продолжить',
        menu: 'Меню',
        paused: 'Пауза',
        gameOver: 'Пузырёк уплыл',
        score: 'Очки',
        best: 'Рекорд',
        record: 'Новый рекорд!',
        continueAd: '▶ Ещё попытка за рекламу',
        soundOn: 'Звук: вкл',
        soundOff: 'Звук: выкл',
      }
    : {
        title: 'Bubble Level',
        tagline: 'The birds get the plank. You keep it level.',
        howTo: 'Birds land on the plank and tip it. Press left or right to slide the weight that way. Keep the bubble between the marks.',
        play: 'Keep it level',
        again: 'Again',
        resume: 'Resume',
        menu: 'Menu',
        paused: 'Paused',
        gameOver: 'The bubble got away',
        score: 'Score',
        best: 'Best',
        record: 'New record!',
        continueAd: '▶ One more try for an ad',
        soundOn: 'Sound: on',
        soundOff: 'Sound: off',
      };

const BIRD_LOOK: Record<BirdKind, { body: string; belly: string; size: number; voice: [number, number] }> = {
  sparrow: { body: '#8a5a3b', belly: '#e8cfae', size: 20, voice: [2600, 3100] },
  pigeon: { body: '#8796a8', belly: '#c9d2dc', size: 26, voice: [900, 700] },
  crow: { body: '#26272c', belly: '#3d3f47', size: 31, voice: [520, 430] },
};

const PLANK_T = 18;
const VIAL_W = 150;
const VIAL_H = 30;
/** Высота стоек трубки над доской: грузик проезжает под ней. */
const VIAL_LIFT = 52;

class BubbleGame implements Game {
  private model = new BubbleModel();
  private touches = new Map<number, 'left' | 'right'>();
  private keys = { left: false, right: false };
  private wind: { x: number; y: number; len: number; dir: number }[] = [];
  private warnIn = 0;

  constructor(
    private readonly stage: Stage,
    private readonly synth: Synth,
    private readonly ru: boolean,
  ) {
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ф') this.keys.left = down;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'в') this.keys.right = down;
    };
    window.addEventListener('keydown', key(true));
    window.addEventListener('keyup', key(false));
  }

  get score(): number {
    return this.model.score;
  }
  get over(): boolean {
    return this.model.over;
  }
  hudExtra(): string {
    return '';
  }
  start(): void {
    this.model = new BubbleModel();
    this.touches.clear();
    this.wind = [];
  }
  revive(): void {
    this.model.revive();
    this.touches.clear();
  }

  private side(x: number): 'left' | 'right' {
    return x < WORLD_W / 2 ? 'left' : 'right';
  }
  pointerDown(x: number, _y: number, id: number): void {
    this.touches.set(id, this.side(x));
  }
  pointerMove(x: number, _y: number, id: number): void {
    if (this.touches.has(id)) this.touches.set(id, this.side(x));
  }
  pointerUp(_x: number, _y: number, id: number): void {
    this.touches.delete(id);
  }

  update(dt: number): void {
    const m = this.model;
    const sides = [...this.touches.values()];
    m.left = this.keys.left || sides.includes('left');
    m.right = this.keys.right || sides.includes('right');
    m.update(dt);

    for (const e of m.drainEvents()) {
      if (e.type === 'land') {
        const v = BIRD_LOOK[e.bird.kind].voice;
        this.synth.note(v[0], 0.08, 0.12, 0.6, 'sine');
        this.synth.note(v[1], 0.1, 0.12, 0.72, 'sine');
      } else if (e.type === 'leave') {
        for (let i = 0; i < 4; i++) this.synth.click(1400 + i * 120, 0.03, 0.18, i * 0.05);
      } else if (e.type === 'gust') {
        for (let i = 0; i < 26; i++) {
          this.wind.push({ x: e.dir > 0 ? -Math.random() * 400 : WORLD_W + Math.random() * 400, y: 120 + Math.random() * 600, len: 60 + Math.random() * 90, dir: e.dir });
        }
      } else if (e.type === 'over') this.synth.thud(0.6);
    }

    const moving = m.left !== m.right;
    this.synth.loop('roll', moving ? 0.35 : 0, 240, 2);
    this.synth.loop('wind', this.wind.length > 0 ? 0.5 : 0, 700, 0.7);

    // Тревога: шкала почти пуста — тикаем.
    this.warnIn -= dt;
    if (m.meter < 0.3 && !m.inZone && this.warnIn <= 0) {
      this.synth.click(1600, 0.03, 0.4);
      this.warnIn = 0.25 + m.meter;
    }
    // Пузырёк вернулся в центр — тихая нота.
    if (m.inZone && this.wasOut) this.synth.note(SCALE[4], 0.25, 0.08, 0, 'sine');
    this.wasOut = !m.inZone;

    for (const w of this.wind) w.x += w.dir * 900 * dt;
    this.wind = this.wind.filter((w) => w.x > -600 && w.x < WORLD_W + 600);
  }
  private wasOut = false;

  draw(): void {
    const ctx = this.stage.begin((c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#bfe0ee');
      g.addColorStop(0.7, '#e8f3ef');
      g.addColorStop(1, '#e8f3ef');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const m = this.model;
    this.drawGround(ctx);
    this.drawWind(ctx);
    this.drawPlank(ctx, m);
    this.drawMeter(ctx, m);
    this.drawControls(ctx, m);
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const y = PIVOT.y + 120;
    ctx.fillStyle = '#9cc98a';
    ctx.beginPath();
    ctx.moveTo(-400, y + 20);
    ctx.quadraticCurveTo(WORLD_W / 2, y - 30, WORLD_W + 400, y + 20);
    ctx.lineTo(WORLD_W + 400, WORLD_H + 400);
    ctx.lineTo(-400, WORLD_H + 400);
    ctx.fill();
    // Камень-опора.
    ctx.fillStyle = '#8d8f93';
    ctx.beginPath();
    ctx.moveTo(PIVOT.x, PIVOT.y + PLANK_T / 2);
    ctx.lineTo(PIVOT.x - 70, y + 6);
    ctx.lineTo(PIVOT.x + 70, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(PIVOT.x, PIVOT.y + PLANK_T / 2);
    ctx.lineTo(PIVOT.x - 70, y + 6);
    ctx.lineTo(PIVOT.x - 20, y + 6);
    ctx.closePath();
    ctx.fill();
  }

  private drawWind(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const w of this.wind) {
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(w.x - w.dir * w.len, w.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlank(ctx: CanvasRenderingContext2D, m: BubbleModel): void {
    ctx.save();
    ctx.translate(PIVOT.x, PIVOT.y);
    ctx.rotate(m.angle);

    // Доска.
    ctx.save();
    ctx.shadowColor = 'rgba(30, 50, 40, 0.3)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, -HALF_LEN - 20, -PLANK_T / 2, (HALF_LEN + 20) * 2, PLANK_T, 6);
    const g = ctx.createLinearGradient(0, -PLANK_T / 2, 0, PLANK_T / 2);
    g.addColorStop(0, '#d6a66d');
    g.addColorStop(1, '#ad7c45');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    this.drawVial(ctx, m);
    this.drawWeight(ctx, m.weight);
    for (const b of m.birds) this.drawBird(ctx, b);
    ctx.restore();
  }

  /** Трубка уровня с пузырьком и двумя отметками — на стойках, грузик ездит под ней. */
  private drawVial(ctx: CanvasRenderingContext2D, m: BubbleModel): void {
    const y = -PLANK_T / 2 - VIAL_H - VIAL_LIFT;
    ctx.fillStyle = '#b98a2a';
    for (const x of [-VIAL_W / 2 + 6, VIAL_W / 2 - 14]) ctx.fillRect(x, y + VIAL_H, 8, VIAL_LIFT);
    // Корпус.
    roundRect(ctx, -VIAL_W / 2 - 12, y - 6, VIAL_W + 24, VIAL_H + 12, 10);
    ctx.fillStyle = '#e9b52d';
    ctx.fill();
    // Жидкость.
    roundRect(ctx, -VIAL_W / 2, y, VIAL_W, VIAL_H, VIAL_H / 2);
    const liquid = m.inZone ? '#c6ec7a' : '#f3a98c';
    ctx.fillStyle = liquid;
    ctx.fill();
    // Отметки.
    const zx = (m.zone * (VIAL_W - VIAL_H)) / 2;
    ctx.strokeStyle = '#2b3a33';
    ctx.lineWidth = 3;
    for (const x of [-zx - 14, zx + 14]) {
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x, y + VIAL_H - 3);
      ctx.stroke();
    }
    // Пузырёк.
    const bx = (m.bubble * (VIAL_W - VIAL_H)) / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    ctx.ellipse(bx, y + VIAL_H / 2, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.beginPath();
    ctx.ellipse(bx - 5, y + VIAL_H / 2 - 3, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Блик стекла.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-VIAL_W / 2 + 14, y + 6);
    ctx.lineTo(VIAL_W / 2 - 14, y + 6);
    ctx.stroke();
  }

  private drawWeight(ctx: CanvasRenderingContext2D, w: number): void {
    const top = -PLANK_T / 2;
    ctx.save();
    ctx.translate(w, top);
    ctx.fillStyle = '#3d4249';
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(22, 0);
    ctx.lineTo(15, -30);
    ctx.lineTo(-15, -30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3d4249';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, -36, 8, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-12, -25, 5, 20);
    ctx.restore();
  }

  private drawBird(ctx: CanvasRenderingContext2D, b: Bird): void {
    const look = BIRD_LOOK[b.kind];
    const r = look.size;
    const top = -PLANK_T / 2;
    let dy = 0;
    let dx = 0;
    let flap = 0;
    if (b.phase === 'landing') {
      const k = Math.min(1, b.t / 0.9);
      dy = -((1 - k) ** 2) * 380;
      dx = (1 - k) * 60 * Math.sign(b.s);
      flap = 1;
    } else if (b.phase === 'leaving') {
      const k = b.t / 0.6;
      dy = -k * k * 420;
      dx = k * 120 * Math.sign(b.s);
      flap = 1;
    }
    const face = b.s > 0 ? -1 : 1;
    ctx.save();
    ctx.translate(b.s + dx, top + dy);
    // Лапки.
    if (b.phase === 'sitting') {
      ctx.strokeStyle = '#d07a2a';
      ctx.lineWidth = 3;
      for (const lx of [-5, 5]) {
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx, -8);
        ctx.stroke();
      }
    }
    // Тело.
    ctx.fillStyle = look.body;
    ctx.beginPath();
    ctx.ellipse(0, -8 - r * 0.8, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.belly;
    ctx.beginPath();
    ctx.ellipse(face * r * 0.25, -8 - r * 0.6, r * 0.6, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Крыло (машет в полёте).
    const t = performance.now() / 1000;
    const wing = flap ? Math.sin(t * 30) * 0.9 : 0;
    ctx.save();
    ctx.translate(-face * r * 0.2, -8 - r * 0.9);
    ctx.rotate(-face * (0.3 + wing));
    ctx.fillStyle = look.body;
    ctx.beginPath();
    ctx.ellipse(-face * r * 0.4, 0, r * 0.75, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Голова, глаз, клюв.
    const hx = face * r * 0.75;
    const hy = -8 - r * 1.45;
    ctx.fillStyle = look.body;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx + face * r * 0.18, hy - 3, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(hx + face * r * 0.22, hy - 3, r * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = b.kind === 'crow' ? '#3a3a3a' : '#e6a12b';
    ctx.beginPath();
    ctx.moveTo(hx + face * r * 0.45, hy - 2);
    ctx.lineTo(hx + face * r * 0.9, hy + 2);
    ctx.lineTo(hx + face * r * 0.45, hy + 5);
    ctx.fill();
    ctx.restore();
    void BIRD_MASS;
  }

  /** Шкала спокойствия над сценой. */
  private drawMeter(ctx: CanvasRenderingContext2D, m: BubbleModel): void {
    const x = 70;
    const y = 120;
    const w = WORLD_W - 140;
    ctx.font = '600 20px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(31, 51, 64, 0.7)';
    ctx.fillText(this.ru ? 'Спокойствие' : 'Calm', WORLD_W / 2, y - 6);
    roundRect(ctx, x, y, w, 14, 7);
    ctx.fillStyle = 'rgba(31, 51, 64, 0.12)';
    ctx.fill();
    const low = m.meter < 0.3;
    const pulse = low ? 0.6 + 0.4 * Math.sin(performance.now() / 90) : 1;
    ctx.globalAlpha = pulse;
    roundRect(ctx, x, y, Math.max(14, w * m.meter), 14, 7);
    ctx.fillStyle = low ? '#d9573b' : m.meter < 0.6 ? '#e3a32d' : '#2a8c6a';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Подсказки управления: левая и правая половины, подсвечены при нажатии. */
  private drawControls(ctx: CanvasRenderingContext2D, m: BubbleModel): void {
    const y = WORLD_H - 90;
    for (const [side, on] of [
      [-1, m.left],
      [1, m.right],
    ] as const) {
      const x = WORLD_W / 2 + side * 170;
      ctx.beginPath();
      ctx.arc(x, y, 46, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(42, 140, 106, 0.85)' : 'rgba(255, 255, 255, 0.55)';
      ctx.fill();
      ctx.fillStyle = on ? '#ffffff' : '#1f3340';
      ctx.beginPath();
      ctx.moveTo(x + side * 16, y);
      ctx.lineTo(x - side * 10, y - 16);
      ctx.lineTo(x - side * 10, y + 16);
      ctx.closePath();
      ctx.fill();
    }
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = new Stage(canvas, { width: WORLD_W, height: WORLD_H });
void startShell(
  {
    storageKey: 'bubble-level.v1',
    texts: TEXTS,
    create: ({ synth, ru }) => new BubbleGame(stage, synth, ru),
    stageToWorld: (x, y) => stage.toWorld(x, y),
  },
  canvas,
  runLoop,
);
