import { Sound } from './audio/sound';
import { generateLevel } from './core/level';
import { GameEvent, Session } from './core/session';
import { setLang, t } from './i18n';
import { Platform, Progress, initPlatform } from './platform/platform';
import { Renderer, viewportArea } from './render/renderer';
import { layoutForViewport } from './core/world';
import { Settings, loadSettings, saveSettings } from './settings';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
/** Полноэкранная реклама — не раньше, чем с этого уровня. */
const ADS_FROM_LEVEL = 3;

type AppState = 'menu' | 'playing' | 'paused' | 'result' | 'ad';

class App {
  private state: AppState = 'menu';
  private session: Session | null = null;
  private progress!: Progress;
  private readonly renderer: Renderer;
  private readonly screen = byId('screen');
  private readonly hud = byId('hud');
  private lastTime = 0;
  private acc = 0;
  private readonly sound = new Sound();
  private readonly settings: Settings = loadSettings();

  constructor(
    private readonly platform: Platform,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.renderer = new Renderer(canvas);
    this.sound.setMuted(this.settings.muted);
  }

  async start(): Promise<void> {
    this.progress = await this.platform.loadProgress();
    this.bindInput();
    this.showMenu();
    this.platform.ready();
    requestAnimationFrame((ts) => this.frame(ts));
  }

  // ——— цикл ———

  private frame(ts: number): void {
    const dt = this.lastTime ? Math.min(0.1, (ts - this.lastTime) / 1000) : 0;
    this.lastTime = ts;

    const s = this.session;
    if (s && this.state === 'playing') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
        s.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      const events = s.drainEvents();
      this.renderer.handleEvents(events);
      this.playSounds(events, s);
      this.updateHud();
      if (s.status !== 'playing') this.finishLevel();
    }

    this.sound.setRake(s && this.state === 'playing' ? s.rakeActivity : 0);
    this.renderer.draw(s, this.state === 'playing' ? dt : 0);
    requestAnimationFrame((t2) => this.frame(t2));
  }

  private playSounds(events: readonly GameEvent[], s: Session): void {
    for (const e of events) {
      switch (e.type) {
        case 'sorted':
          this.sound.play('sorted', { progress: s.sortedCount / Math.max(1, s.totalTargets) });
          break;
        case 'grab':
        case 'wrong':
        case 'slipped':
        case 'won':
        case 'lost':
          this.sound.play(e.type);
          break;
      }
    }
  }

  private toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.sound.setMuted(this.settings.muted);
    saveSettings(this.settings);
    this.updateSoundButton();
  }

  private updateSoundButton(): void {
    const b = byId('hud-sound');
    b.classList.toggle('off', this.settings.muted);
    b.setAttribute('aria-pressed', String(!this.settings.muted));
    b.setAttribute('aria-label', this.settings.muted ? t().soundOff : t().soundOn);
  }

  // ——— ввод ———

  private bindInput(): void {
    const c = this.canvas;
    const toWorld = (e: PointerEvent) => this.renderer.toWorld(e.clientX, e.clientY);

    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'playing' || !this.session) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const p = toWorld(e);
      this.session.chop.hover = e.pointerType === 'mouse';
      this.session.pointerDown(p.x, p.y, e.pointerType !== 'mouse');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.session) return;
      const p = toWorld(e);
      this.session.chop.hover = e.pointerType === 'mouse';
      this.session.pointerMove(p.x, p.y);
    });
    const up = () => this.session?.pointerUp();
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => {
      if (this.session && e.pointerType === 'mouse') this.session.chop.hover = false;
    });

    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Звук разрешается только после действия игрока.
    const unlock = () => this.sound.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    // Щелчок на любую кнопку интерфейса. Срабатывает после обработчика кнопки,
    // поэтому кнопка звука щёлкает, только когда звук включают.
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.btn, .level-btn, .hud-btn')) this.sound.play('ui');
    });

    document.addEventListener('visibilitychange', () => {
      this.sound.setSuspended('hidden', document.hidden);
      if (document.hidden) this.pause();
    });
    this.platform.onPause(() => {
      this.sound.setSuspended('platform', true);
      this.pause();
    });
    this.platform.onResume(() => this.sound.setSuspended('platform', false));
    byId('hud-pause').addEventListener('click', () => this.pause());
    byId('hud-sound').addEventListener('click', () => this.toggleMute());
    this.updateSoundButton();
  }

  // ——— уровни ———

  private startLevel(index: number): void {
    const area = viewportArea();
    const layout = layoutForViewport(area.w, area.h);
    this.session = new Session(generateLevel(index), layout);
    this.renderer.setLayout(layout);
    this.renderer.clearFx();
    this.acc = 0;
    this.state = 'playing';
    this.sound.setSuspended('pause', false);
    this.hideScreen();
    this.hud.classList.remove('hidden');
    this.updateHud();
    this.showGoal(index);
    this.platform.gameplayStart();
  }

  private finishLevel(): void {
    const s = this.session;
    if (!s) return;
    this.platform.gameplayStop();
    this.state = 'result';
    const level = s.config.index;
    const won = s.status === 'won';
    const stars = s.stars();
    if (won) {
      this.progress.stars[level] = Math.max(this.progress.stars[level] ?? 0, stars);
      this.progress.unlocked = Math.max(this.progress.unlocked, level + 1);
      void this.platform.saveProgress(this.progress);
    }
    this.showResult(level, won, stars, s.mistakes);
  }

  private pause(): void {
    if (this.state !== 'playing' || !this.session) return;
    this.session.pointerUp();
    this.platform.gameplayStop();
    this.state = 'paused';
    this.sound.setSuspended('pause', true);
    this.showPause();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.lastTime = 0;
    this.sound.setSuspended('pause', false);
    this.hideScreen();
    this.platform.gameplayStart();
  }

  private async goNext(level: number): Promise<void> {
    if (level >= ADS_FROM_LEVEL) {
      this.state = 'ad';
      this.hideScreen();
      // Яндекс требует тишины, пока идёт реклама.
      this.sound.setSuspended('ad', true);
      await this.platform.showInterstitial();
      this.sound.setSuspended('ad', false);
    }
    this.startLevel(level + 1);
  }

  // ——— экраны ———

  private showMenu(): void {
    this.state = 'menu';
    this.session = null;
    this.sound.setSuspended('pause', false);
    this.hud.classList.add('hidden');
    const tr = t();
    const current = this.progress.unlocked;

    const grid = el('div', 'levels');
    for (let i = 1; i <= current; i++) {
      const b = el('button', 'level-btn');
      b.append(el('span', 'level-num', String(i)), el('span', 'level-stars', starsText(this.progress.stars[i] ?? 0)));
      b.addEventListener('click', () => this.startLevel(i));
      grid.append(b);
    }

    const soundBtn = button(this.settings.muted ? tr.soundOff : tr.soundOn, () => {
      this.toggleMute();
      soundBtn.textContent = this.settings.muted ? tr.soundOff : tr.soundOn;
    });

    this.showScreen(
      el('h1', 'title', tr.title),
      button(`${tr.play} · ${tr.level} ${current}`, () => this.startLevel(current), 'primary'),
      soundBtn,
      grid,
    );
  }

  private showPause(): void {
    const tr = t();
    const level = this.session?.config.index ?? 1;
    this.showScreen(
      el('h2', '', tr.paused),
      button(tr.resume, () => this.resume(), 'primary'),
      button(tr.restart, () => this.startLevel(level)),
      button(tr.menu, () => this.showMenu()),
    );
  }

  private showResult(level: number, won: boolean, stars: number, mistakes: number): void {
    const tr = t();
    const parts: HTMLElement[] = [el('h2', '', won ? tr.won : tr.lost)];
    if (won) parts.push(el('div', 'stars', starsText(stars)));
    parts.push(el('p', 'muted', `${tr.level} ${level} · ${tr.mistakes}: ${mistakes}`));
    if (won) parts.push(button(tr.next, () => void this.goNext(level), 'primary'));
    parts.push(button(tr.retry, () => this.startLevel(level), won ? '' : 'primary'));
    parts.push(button(tr.menu, () => this.showMenu()));
    this.showScreen(...parts);
  }

  private showGoal(level: number): void {
    const s = this.session;
    if (!s) return;
    const tr = t();
    const names = s.config.targets.map((k) => tr.grains[k]).join(', ');
    const toast = el('div', 'toast');
    toast.append(el('div', 'toast-title', `${tr.level} ${level}`), el('div', '', tr.levelGoal(names)));
    if (level === 1) toast.append(el('div', 'toast-hint', tr.hint));
    document.getElementById('app')!.append(toast);
    setTimeout(() => toast.classList.add('fade'), level === 1 ? 5000 : 2200);
    setTimeout(() => toast.remove(), level === 1 ? 5600 : 2800);
  }

  private updateHud(): void {
    const s = this.session;
    if (!s) return;
    const tr = t();
    byId('hud-level').textContent = `${tr.level} ${s.config.index}`;
    byId('hud-progress').textContent =
      `${s.sortedCount}/${s.totalTargets}` + (s.mistakes > 0 ? ` · ✕${s.mistakes}` : '');
    const left = s.timeLeft;
    const time = byId('hud-time');
    if (left === null) {
      time.textContent = '';
      time.classList.add('hidden');
    } else {
      const sec = Math.ceil(left);
      time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      time.classList.remove('hidden');
      time.classList.toggle('warn', left <= 10);
    }
  }

  private showScreen(...children: HTMLElement[]): void {
    const card = el('div', 'card');
    card.append(...children);
    this.screen.replaceChildren(card);
    this.screen.classList.add('visible');
  }

  private hideScreen(): void {
    this.screen.classList.remove('visible');
    this.screen.replaceChildren();
  }
}

// ——— DOM-помощники ———

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e;
}

function el(tag: string, className = '', text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, variant = ''): HTMLElement {
  const b = el('button', `btn ${variant}`.trim(), text);
  b.addEventListener('click', onClick);
  return b;
}

function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

async function boot(): Promise<void> {
  const platform = await initPlatform();
  setLang(platform.lang);
  const canvas = byId('game') as HTMLCanvasElement;
  const app = new App(platform, canvas);
  // Отладка и e2e-проверки: доступ к игре из консоли при ?debug в адресе.
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __game: App }).__game = app;
  }
  await app.start();
}

void boot();
