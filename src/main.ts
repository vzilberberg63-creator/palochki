import { Sound } from './audio/sound';
import { HeapSession } from './core/heap';
import { GameMode, generateLevelFor } from './core/level';
import { GameEvent, Session, StickMask } from './core/session';
import { setLang, t } from './i18n';
import { ModeProgress, Platform, Progress, initPlatform } from './platform/platform';
import { AD_COIN_MULTIPLIER, CONTINUE_SECONDS, SHOP_AD_COINS, coinsForWin } from './core/economy';
import { SKINS, SkinId, skinById } from './core/skins';
import { Renderer, URGENT_SECONDS, drawChopsticksPreview, viewportArea } from './render/renderer';
import { heapLayout, layoutForViewport } from './core/world';
import { Settings, loadSettings, saveSettings } from './settings';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
/** Полноэкранная реклама — не раньше, чем с этого уровня. */
const ADS_FROM_LEVEL = 3;
/** Ширина экрана (CSS px), ниже которой верхняя панель становится компактной. */
const NARROW_HUD = 440;

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
  /** Последняя секунда, на которой прозвучал тик часов. */
  private lastTick = 0;
  /** Идёт показ рекламы за награду: кнопки не реагируют повторно. */
  private adBusy = false;
  private intruderHintShown = false;
  /** Какие кнопки мыши были зажаты в прошлом событии. */
  private lastButtons = 0;
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
    this.renderer.setSkin(skinById(this.progress.skin));
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
      this.tickClock(s);
      this.maybeIntruderHint(s);
      this.updateHud();
      if (s.status !== 'playing') this.finishLevel();
    }

    this.sound.setRake(s && this.state === 'playing' ? s.rakeActivity : 0);
    this.renderer.draw(s, this.state === 'playing' ? dt : 0);
    requestAnimationFrame((t2) => this.frame(t2));
  }

  private playSounds(events: readonly GameEvent[], s: Session): void {
    // В «Кучках» в копилку въезжает сразу десяток зёрен: одна нота на кадр, а не десять разом.
    let sortedPlayed = false;
    let wrongPlayed = false;
    for (const e of events) {
      switch (e.type) {
        case 'sorted':
          if (sortedPlayed) break;
          sortedPlayed = true;
          this.sound.play('sorted', { progress: s.sortedCount / Math.max(1, s.totalTargets) });
          break;
        case 'combo':
          this.sound.play('combo', { multiplier: e.multiplier });
          break;
        case 'wrong':
          if (wrongPlayed) break;
          wrongPlayed = true;
          this.sound.play('wrong');
          break;
        case 'comboLost':
        case 'timeBonus':
        case 'grab':
        case 'slipped':
        case 'won':
        case 'lost':
          this.sound.play(e.type);
          break;
      }
    }
  }

  /** «Кучки»: все свои зёрна уже в копилках, но мешают чужие — подсказываем один раз. */
  private maybeIntruderHint(s: Session): void {
    if (this.intruderHintShown || !(s instanceof HeapSession) || s.status !== 'playing') return;
    if (s.sortedCount < s.totalTargets || s.intruders.size === 0) return;
    this.intruderHintShown = true;
    this.toast(t().intruderHint, 3000);
  }

  private toast(text: string, ms: number): void {
    const toast = el('div', 'toast');
    toast.append(el('div', '', text));
    document.getElementById('app')!.append(toast);
    setTimeout(() => toast.classList.add('fade'), ms);
    setTimeout(() => toast.remove(), ms + 600);
  }

  /** Последние секунды тикают раз в секунду. */
  private tickClock(s: Session): void {
    const left = s.timeLeft;
    if (left === null || left <= 0 || left > URGENT_SECONDS || s.status !== 'playing') {
      this.lastTick = 0;
      return;
    }
    const sec = Math.ceil(left);
    if (sec !== this.lastTick) {
      this.lastTick = sec;
      this.sound.play('tick', { secondsLeft: sec });
    }
  }

  private save(): void {
    this.progress.rev++;
    void this.platform.saveProgress(this.progress);
  }

  /**
   * Показать рекламу за награду. Игра и звук стоят, пока она идёт.
   * Возвращает true, если награду надо выдать.
   */
  private async rewarded(): Promise<boolean> {
    if (this.adBusy) return false;
    this.adBusy = true;
    this.sound.setSuspended('ad', true);
    try {
      return await this.platform.showRewarded();
    } finally {
      this.sound.setSuspended('ad', false);
      this.adBusy = false;
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
      this.lastButtons = e.buttons;
      this.session.pointerDown(p.x, p.y, e.pointerType !== 'mouse', stickMask(e));
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.session) return;
      const p = toWorld(e);
      this.session.chop.hover = e.pointerType === 'mouse';
      this.session.pointerMove(p.x, p.y);
      // Вторую кнопку мыши, нажатую или отпущенную при зажатой первой, браузер присылает
      // не как pointerdown/pointerup, а как движение с другим набором кнопок.
      if (e.pointerType === 'mouse' && e.buttons !== this.lastButtons && this.session instanceof HeapSession) {
        this.lastButtons = e.buttons;
        if (this.state === 'playing') this.session.setSticks(stickMask(e));
      }
    });
    const up = () => {
      this.lastButtons = 0;
      this.session?.pointerUp();
    };
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

  private get mode(): GameMode {
    return this.settings.mode;
  }

  /** Прохождение текущего режима: у «По зёрнышку» оно в корне прогресса, у «Кучек» — в progress.heap. */
  private modeProgress(mode: GameMode = this.mode): ModeProgress {
    return mode === 'heap' ? this.progress.heap : this.progress;
  }

  private startLevel(index: number): void {
    const area = viewportArea();
    const base = layoutForViewport(area.w, area.h);
    const config = generateLevelFor(this.mode, index);
    const layout = this.mode === 'heap' ? heapLayout(base) : base;
    this.session = this.mode === 'heap' ? new HeapSession(config, layout) : new Session(config, layout);
    this.intruderHintShown = false;
    this.renderer.setLayout(layout);
    this.renderer.clearFx();
    this.acc = 0;
    this.lastTick = 0;
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
    let record = false;
    let coins = 0;
    if (won) {
      const mp = this.modeProgress(s.config.mode);
      const prevBest = mp.best[level] ?? 0;
      // Рекорд — только если до этого уровень уже проходили, иначе любой результат «рекорд».
      record = prevBest > 0 && s.score > prevBest;
      mp.best[level] = Math.max(prevBest, s.score);
      mp.stars[level] = Math.max(mp.stars[level] ?? 0, stars);
      mp.unlocked = Math.max(mp.unlocked, level + 1);
      coins = coinsForWin(stars, s.score);
      this.progress.coins += coins;
      this.save();
    }
    this.showResult(s, stars, record, coins);
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
    const mp = this.modeProgress();
    const current = mp.unlocked;

    // Переключатель режимов: «Кучки» (как в ролике) и «По зёрнышку».
    const modes = el('div', 'modes');
    modes.setAttribute('role', 'tablist');
    for (const m of ['heap', 'pick'] as const) {
      const b = el('button', `mode-btn${m === this.mode ? ' active' : ''}`);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(m === this.mode));
      b.append(el('span', 'mode-name', tr.modes[m]), el('span', 'mode-desc', tr.modeDesc[m]));
      b.addEventListener('click', () => {
        if (this.settings.mode === m) return;
        this.settings.mode = m;
        saveSettings(this.settings);
        this.showMenu();
      });
      modes.append(b);
    }

    const grid = el('div', 'levels');
    for (let i = 1; i <= current; i++) {
      const b = el('button', 'level-btn');
      b.append(el('span', 'level-num', String(i)), el('span', 'level-stars', starsText(mp.stars[i] ?? 0)));
      b.addEventListener('click', () => this.startLevel(i));
      grid.append(b);
    }

    const soundBtn = button(this.settings.muted ? tr.soundOff : tr.soundOn, () => {
      this.toggleMute();
      soundBtn.textContent = this.settings.muted ? tr.soundOff : tr.soundOn;
    });

    this.showScreen(
      el('h1', 'title', tr.title),
      coinBalance(this.progress.coins),
      modes,
      button(`${tr.play} · ${tr.level} ${current}`, () => this.startLevel(current), 'primary'),
      button(tr.shop, () => this.showShop()),
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

  private showResult(s: Session, stars: number, record: boolean, coins: number): void {
    const tr = t();
    const level = s.config.index;
    const won = s.status === 'won';
    const parts: HTMLElement[] = [el('h2', '', won ? tr.won : tr.lost)];
    if (won) parts.push(el('div', 'stars', starsText(stars)));

    // Время вышло: один раз за попытку можно продолжить за рекламу.
    if (!won && s.canContinue()) {
      const cont = button(tr.continueAd(CONTINUE_SECONDS), () => void this.continueAfterAd(s, cont), 'primary ad');
      parts.push(cont);
    }
    const score = el('div', 'score');
    score.append(el('span', 'score-label', tr.score), el('span', 'score-value', String(s.score)));
    parts.push(score);
    if (record) parts.push(el('div', 'record', tr.record));
    parts.push(
      el(
        'p',
        'muted',
        `${tr.level} ${level} · ${tr.mistakes}: ${s.mistakes} · ${tr.bestCombo}: ${s.bestCombo}`,
      ),
    );
    if (won && coins > 0) {
      const earned = el('div', 'earned');
      const amount = el('span', 'coin', `+${coins}`);
      earned.append(el('span', 'score-label', tr.coins), amount);
      parts.push(earned);
      const extra = coins * (AD_COIN_MULTIPLIER - 1);
      const dbl = button(tr.doubleCoinsAd(AD_COIN_MULTIPLIER), async () => {
        if (!(await this.rewarded())) return;
        this.progress.coins += extra;
        this.save();
        amount.textContent = `+${coins + extra}`;
        dbl.remove();
        this.sound.play('coins');
      }, 'ad');
      parts.push(dbl);
    }
    if (won) parts.push(button(tr.next, () => void this.goNext(level), 'primary'));
    const canContinue = !won && s.canContinue();
    parts.push(button(tr.retry, () => this.startLevel(level), won || canContinue ? '' : 'primary'));
    parts.push(button(tr.menu, () => this.showMenu()));
    this.showScreen(...parts);
    if (won && coins > 0) this.sound.play('coins');
  }

  private async continueAfterAd(s: Session, btn: HTMLElement): Promise<void> {
    btn.setAttribute('disabled', '');
    if (!(await this.rewarded()) || this.session !== s) {
      btn.removeAttribute('disabled');
      return;
    }
    s.continueWithTime(CONTINUE_SECONDS);
    this.state = 'playing';
    this.lastTime = 0;
    this.lastTick = 0;
    this.hideScreen();
    this.updateHud();
    this.platform.gameplayStart();
  }

  // ——— магазин палочек ———

  private showShop(): void {
    this.state = 'menu';
    const tr = t();
    const header = el('div', 'shop-header');
    header.append(el('h2', '', tr.shop), coinBalance(this.progress.coins));

    const grid = el('div', 'shop-grid');
    const previews: [HTMLCanvasElement, SkinId][] = [];
    for (const skin of SKINS) {
      const card = el('div', 'skin-card');
      const owned = this.progress.skins.includes(skin.id);
      const selected = this.progress.skin === skin.id;
      card.classList.toggle('selected', selected);
      const canvas = document.createElement('canvas');
      canvas.className = 'skin-preview';
      previews.push([canvas, skin.id]);
      card.append(canvas, el('div', 'skin-name', tr.skins[skin.id]));

      let action: HTMLElement;
      if (selected) {
        action = el('button', 'btn small', tr.selected);
        action.setAttribute('disabled', '');
      } else if (owned) {
        action = button(tr.select, () => this.selectSkin(skin.id), 'small');
      } else {
        const affordable = this.progress.coins >= skin.price;
        action = button(String(skin.price), () => this.buySkin(skin.id), `small coin-btn ${affordable ? 'primary' : ''}`);
        if (!affordable) {
          action.setAttribute('disabled', '');
          action.title = tr.notEnough(skin.price - this.progress.coins);
        }
      }
      card.append(action);
      grid.append(card);
    }

    const adCoins = button(tr.shopAdCoins(SHOP_AD_COINS), async () => {
      if (!(await this.rewarded())) return;
      this.progress.coins += SHOP_AD_COINS;
      this.save();
      this.sound.play('coins');
      this.showShop();
    }, 'ad');

    this.showScreen(header, el('p', 'muted', tr.shopHint), grid, adCoins, button(tr.back, () => this.showMenu()));
    this.screen.querySelector('.card')?.classList.add('wide');
    requestAnimationFrame(() => {
      for (const [canvas, id] of previews) drawChopsticksPreview(canvas, skinById(id));
    });
  }

  private buySkin(id: SkinId): void {
    const skin = skinById(id);
    if (this.progress.skins.includes(id) || this.progress.coins < skin.price) return;
    this.progress.coins -= skin.price;
    this.progress.skins.push(id);
    this.progress.skin = id;
    this.renderer.setSkin(skin);
    this.save();
    this.sound.play('purchase');
    this.showShop();
  }

  private selectSkin(id: SkinId): void {
    if (!this.progress.skins.includes(id)) return;
    this.progress.skin = id;
    this.renderer.setSkin(skinById(id));
    this.save();
    this.showShop();
  }

  private showGoal(level: number): void {
    const s = this.session;
    if (!s) return;
    const tr = t();
    const names = s.config.targets.map((k) => tr.grains[k]).join(', ');
    const toast = el('div', 'toast');
    const heap = s.config.mode === 'heap';
    toast.append(
      el('div', 'toast-title', `${tr.level} ${level}`),
      el('div', '', heap ? tr.heapGoal(names) : tr.levelGoal(names)),
    );
    if (level === 1) {
      toast.append(el('div', 'toast-hint', heap ? tr.heapHint : tr.hint));
      // На компьютере с мышью — подсказка про две кнопки.
      if (heap && window.matchMedia('(pointer: fine)').matches) toast.append(el('div', 'toast-hint', tr.heapMouseHint));
    }
    document.getElementById('app')!.append(toast);
    setTimeout(() => toast.classList.add('fade'), level === 1 ? 7000 : 2200);
    setTimeout(() => toast.remove(), level === 1 ? 7600 : 2800);
  }

  private updateHud(): void {
    const s = this.session;
    if (!s) return;
    const tr = t();
    // На узком экране — короткая подпись, чтобы панель с таймером, ошибками и кнопками влезла.
    const narrow = window.innerWidth < NARROW_HUD;
    byId('hud-level').textContent = `${narrow ? tr.levelShort : tr.level} ${s.config.index}`;
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

/** Левая кнопка мыши — левая палочка, правая — правая. Палец и перо опускают обе. */
function stickMask(e: PointerEvent): StickMask {
  if (e.pointerType !== 'mouse') return { left: true, right: true };
  const left = (e.buttons & 1) !== 0;
  const right = (e.buttons & 2) !== 0;
  // Средняя кнопка и прочие — как обе палочки.
  if (!left && !right) return { left: true, right: true };
  return { left, right };
}

function coinBalance(coins: number): HTMLElement {
  return el('div', 'balance coin', String(coins));
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
