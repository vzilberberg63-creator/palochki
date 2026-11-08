import { Synth } from './audio';
import { Platform, initPlatform, isRussian } from './platform';

/**
 * Общая «оболочка» мини-игры: меню, пауза, экран итогов, рекорд, звук, реклама.
 * Игра описывает только себя (Game), а оболочка — всё, что требуется для Яндекс Игр:
 * паузу при сворачивании и по событию платформы, тишину во время рекламы,
 * продолжение за рекламу и полноэкранную рекламу между партиями.
 */

export interface Texts {
  title: string;
  tagline: string;
  howTo: string;
  play: string;
  again: string;
  resume: string;
  menu: string;
  paused: string;
  gameOver: string;
  score: string;
  best: string;
  record: string;
  continueAd: string;
  soundOn: string;
  soundOff: string;
}

export interface Game {
  /** Новая партия с нуля. */
  start(): void;
  /** Продолжить после проигрыша (за рекламу). */
  revive(): void;
  update(dt: number): void;
  draw(dt: number): void;
  /** id — номер касания: несколько пальцев можно различать. */
  pointerDown(x: number, y: number, id: number): void;
  pointerMove(x: number, y: number, id: number): void;
  pointerUp(x: number, y: number, id: number): void;
  readonly score: number;
  readonly over: boolean;
  /** Строка в HUD справа от счёта: жизни, время и т.п. */
  hudExtra(): string;
}

export interface ShellOptions {
  /** Ключ сохранения рекорда. */
  storageKey: string;
  texts: (ru: boolean) => Texts;
  create: (env: { synth: Synth; ru: boolean; platform: Platform }) => Game;
  stageToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** С какой партии показывать полноэкранную рекламу между партиями. */
  adsFromGame?: number;
}

interface Save {
  best: number;
  muted: boolean;
}

type State = 'menu' | 'playing' | 'paused' | 'over' | 'ad';

export async function startShell(opts: ShellOptions, canvas: HTMLCanvasElement, loop: (u: (dt: number) => void, d: (dt: number) => void) => void): Promise<void> {
  const platform = await initPlatform();
  const ru = isRussian(platform.lang);
  document.documentElement.lang = ru ? 'ru' : 'en';
  const t = opts.texts(ru);
  const synth = new Synth();
  const saved = (await platform.load<Save>(opts.storageKey)) ?? { best: 0, muted: false };
  const save: Save = { best: Number(saved.best) || 0, muted: saved.muted === true };
  synth.setMuted(save.muted);
  const game = opts.create({ synth, ru, platform });

  const screen = byId('screen');
  const hud = byId('hud');
  let state: State = 'menu';
  let revived = false;
  let games = 0;
  let adBusy = false;

  const persist = () => void platform.save(opts.storageKey, save);

  // ——— ввод ———
  const unlock = () => synth.unlock();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('button')) synth.click(1800, 0.03, 0.5);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = opts.stageToWorld(e.clientX, e.clientY);
    game.pointerDown(p.x, p.y, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'playing') return;
    const p = opts.stageToWorld(e.clientX, e.clientY);
    game.pointerMove(p.x, p.y, e.pointerId);
  });
  const up = (e: PointerEvent) => {
    if (state !== 'playing') return;
    const p = opts.stageToWorld(e.clientX, e.clientY);
    game.pointerUp(p.x, p.y, e.pointerId);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  document.addEventListener('visibilitychange', () => {
    synth.setSuspended('hidden', document.hidden);
    if (document.hidden) pause();
  });
  platform.onPause(() => {
    synth.setSuspended('platform', true);
    pause();
  });
  platform.onResume(() => synth.setSuspended('platform', false));
  byId('hud-pause').addEventListener('click', () => pause());
  const soundBtn = byId('hud-sound');
  const refreshSound = () => soundBtn.classList.toggle('off', save.muted);
  soundBtn.addEventListener('click', () => {
    save.muted = !save.muted;
    synth.setMuted(save.muted);
    refreshSound();
    persist();
  });
  refreshSound();

  // ——— состояния ———
  function play(): void {
    game.start();
    revived = false;
    games++;
    resumePlay();
  }

  function resumePlay(): void {
    state = 'playing';
    synth.setSuspended('pause', false);
    hideScreen();
    hud.classList.remove('hidden');
    platform.gameplayStart();
  }

  function pause(): void {
    if (state !== 'playing') return;
    state = 'paused';
    synth.setSuspended('pause', true);
    platform.gameplayStop();
    showScreen(el('h2', '', t.paused), button(t.resume, () => resumePlay(), 'primary'), button(t.menu, showMenu));
  }

  async function rewarded(): Promise<boolean> {
    if (adBusy) return false;
    adBusy = true;
    synth.setSuspended('ad', true);
    try {
      return await platform.showRewarded();
    } finally {
      synth.setSuspended('ad', false);
      adBusy = false;
    }
  }

  async function playAgain(): Promise<void> {
    if (games >= (opts.adsFromGame ?? 2)) {
      state = 'ad';
      hideScreen();
      synth.setSuspended('ad', true);
      await platform.showInterstitial();
      synth.setSuspended('ad', false);
    }
    play();
  }

  function gameOver(): void {
    state = 'over';
    platform.gameplayStop();
    const score = game.score;
    const record = score > save.best && save.best > 0;
    if (score > save.best) {
      save.best = score;
      persist();
    }
    const parts: HTMLElement[] = [el('h2', '', t.gameOver)];
    const big = el('div', 'score');
    big.append(el('span', 'label', t.score), el('span', 'value', String(score)));
    parts.push(big);
    parts.push(record ? el('div', 'record', t.record) : el('p', 'muted', `${t.best}: ${save.best}`));
    if (!revived) {
      const cont = button(
        t.continueAd,
        async () => {
          cont.setAttribute('disabled', '');
          if (!(await rewarded())) {
            cont.removeAttribute('disabled');
            return;
          }
          revived = true;
          game.revive();
          resumePlay();
        },
        'primary ad',
      );
      parts.push(cont);
    }
    parts.push(button(t.again, () => void playAgain(), revived ? 'primary' : ''));
    parts.push(button(t.menu, showMenu));
    showScreen(...parts);
  }

  function showMenu(): void {
    state = 'menu';
    synth.setSuspended('pause', false);
    hud.classList.add('hidden');
    const snd = button(save.muted ? t.soundOff : t.soundOn, () => {
      save.muted = !save.muted;
      synth.setMuted(save.muted);
      refreshSound();
      persist();
      snd.textContent = save.muted ? t.soundOff : t.soundOn;
    });
    showScreen(
      el('h1', 'title', t.title),
      el('p', 'tagline', t.tagline),
      el('p', 'howto', t.howTo),
      save.best > 0 ? el('p', 'muted', `${t.best}: ${save.best}`) : el('span'),
      button(t.play, play, 'primary'),
      snd,
    );
  }

  // ——— цикл ———
  loop(
    (dt) => {
      if (state !== 'playing') return;
      game.update(dt);
      byId('hud-score').textContent = String(game.score);
      const extra = game.hudExtra();
      const ex = byId('hud-extra');
      ex.textContent = extra;
      ex.classList.toggle('hidden', !extra);
      if (game.over) gameOver();
    },
    (dt) => game.draw(state === 'playing' ? dt : 0),
  );

  function showScreen(...children: HTMLElement[]): void {
    const card = el('div', 'card');
    card.append(...children);
    screen.replaceChildren(card);
    screen.classList.add('visible');
  }
  function hideScreen(): void {
    screen.classList.remove('visible');
    screen.replaceChildren();
  }

  showMenu();
  platform.ready();
  if (new URLSearchParams(location.search).has('debug')) {
    (window as unknown as { __game: unknown }).__game = { game, play, state: () => state };
  }
}

export function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e;
}

export function el(tag: string, className = '', text?: string): HTMLElement {
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
