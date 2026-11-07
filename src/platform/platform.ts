/**
 * Обёртка над Yandex Games SDK. Игра работает только через этот интерфейс,
 * поэтому локально (без SDK) всё продолжает работать на заглушке.
 *
 * Документация SDK: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 */

import { DEFAULT_SKIN, SkinId, isSkinId } from '../core/skins';

/** Прохождение одного режима. */
export interface ModeProgress {
  /** Максимальный открытый уровень. */
  unlocked: number;
  /** Лучшее количество звёзд по уровням. */
  stars: Record<number, number>;
  /** Рекорд очков по уровням. */
  best: Record<number, number>;
}

/**
 * Прогресс игрока. Поля верхнего уровня — режим «По зёрнышку» (он был первым,
 * так старые сохранения читаются без миграции), heap — режим «Кучки».
 * Монеты и палочки общие для обоих режимов.
 */
export interface Progress extends ModeProgress {
  heap: ModeProgress;
  coins: number;
  /** Купленные стили палочек; стандартный есть всегда. */
  skins: SkinId[];
  /** Выбранный стиль. */
  skin: SkinId;
  /**
   * Номер сохранения, растёт с каждой записью. Монеты могут убывать (покупки),
   * поэтому при слиянии двух копий монеты берутся из более свежей, а не по максимуму.
   */
  rev: number;
}

export interface Platform {
  readonly name: 'yandex' | 'local';
  readonly lang: string;
  /** Игра загрузилась и готова к взаимодействию (LoadingAPI.ready). */
  ready(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Полноэкранная реклама. Промис завершается, когда реклама закрыта или не показалась. */
  showInterstitial(): Promise<void>;
  /** Реклама за награду. true — игрок досмотрел и награду надо выдать. */
  showRewarded(): Promise<boolean>;
  loadProgress(): Promise<Progress>;
  saveProgress(p: Progress): Promise<void>;
  /** Платформа просит поставить игру на паузу (например, открылось окно Яндекса). */
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
}

export function emptyProgress(): Progress {
  return {
    unlocked: 1,
    stars: {},
    best: {},
    heap: { unlocked: 1, stars: {}, best: {} },
    coins: 0,
    skins: [DEFAULT_SKIN],
    skin: DEFAULT_SKIN,
    rev: 0,
  };
}
const STORAGE_KEY = 'palochki.progress.v1';
const SDK_TIMEOUT_MS = 4000;

// ——— минимальные типы SDK, только то, что используем ———
interface YaPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}
interface YaSdk {
  environment: { i18n: { lang: string } };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  adv: {
    showRewardedVideo(opts: {
      callbacks: {
        onOpen?: () => void;
        onRewarded?: () => void;
        onClose?: () => void;
        onError?: (e: unknown) => void;
      };
    }): void;
    showFullscreenAdv(opts: {
      callbacks: {
        onOpen?: () => void;
        onClose?: (wasShown: boolean) => void;
        onError?: (e: unknown) => void;
        onOffline?: () => void;
      };
    }): void;
  };
  getPlayer(opts?: { scope?: boolean }): Promise<YaPlayer>;
  on?(event: 'game_api_pause' | 'game_api_resume', cb: () => void): void;
}
declare global {
  interface Window {
    YaGames?: { init(): Promise<YaSdk> };
  }
}

export function normalizeProgress(raw: unknown): Progress {
  if (!raw || typeof raw !== 'object') return emptyProgress();
  const r = raw as Record<string, unknown>;
  // Прогресс из прошлых версий игры не содержит рекордов, режима «Кучки», монет и стилей — это не ошибка.
  const { unlocked, stars, best } = normalizeMode(r);
  const heap = normalizeMode(r.heap);
  const coins = int(r.coins, 0) ?? 0;
  const skins = ownedSkins(Array.isArray(r.skins) ? r.skins : []);
  const skin = isSkinId(r.skin) && skins.includes(r.skin) ? r.skin : DEFAULT_SKIN;
  const rev = int(r.rev, 0) ?? 0;
  return { unlocked, stars, best, heap, coins, skins, skin, rev };
}

function int(v: unknown, min: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null;
}

function normalizeMode(raw: unknown): ModeProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    unlocked: int(r.unlocked, 1) ?? 1,
    stars: levelMap(r.stars, (v) => Number.isInteger(v) && v >= 0 && v <= 3),
    best: levelMap(r.best, (v) => Number.isInteger(v) && v >= 0),
  };
}

function mergeMode(a: ModeProgress, b: ModeProgress): ModeProgress {
  const maxMap = (x: Record<number, number>, y: Record<number, number>) => {
    const out: Record<number, number> = { ...x };
    for (const [k, v] of Object.entries(y)) {
      const lvl = Number(k);
      out[lvl] = Math.max(out[lvl] ?? 0, v);
    }
    return out;
  };
  return {
    unlocked: Math.max(a.unlocked, b.unlocked),
    stars: maxMap(a.stars, b.stars),
    best: maxMap(a.best, b.best),
  };
}

/** Известные стили без повторов; стандартный всегда первый. */
function ownedSkins(list: readonly unknown[]): SkinId[] {
  const out: SkinId[] = [DEFAULT_SKIN];
  for (const id of list) if (isSkinId(id) && !out.includes(id)) out.push(id);
  return out;
}

function levelMap(raw: unknown, valid: (v: number) => boolean): Record<number, number> {
  const out: Record<number, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const lvl = Number(k);
    if (Number.isInteger(lvl) && lvl >= 1 && typeof v === 'number' && valid(v)) out[lvl] = v;
  }
  return out;
}

function readLocal(): Progress {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return normalizeProgress(s ? JSON.parse(s) : null);
  } catch {
    return emptyProgress();
  }
}

function writeLocal(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Хранилище недоступно (приватный режим) — игра продолжается без сохранения.
  }
}

/**
 * Слияние локальной и облачной копии. Уровни, звёзды и рекорды — лучшее из двух.
 * Купленные стили — объединение. Монеты и выбранный стиль — из более свежей копии,
 * иначе потраченные монеты «воскресали» бы.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const fresh = a.rev >= b.rev ? a : b;
  const skins = ownedSkins([...a.skins, ...b.skins]);
  return {
    ...mergeMode(a, b),
    heap: mergeMode(a.heap, b.heap),
    coins: fresh.coins,
    skins,
    skin: skins.includes(fresh.skin) ? fresh.skin : DEFAULT_SKIN,
    rev: Math.max(a.rev, b.rev),
  };
}

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YaGames) return resolve();
    const s = document.createElement('script');
    // На хостинге Яндекс Игр SDK отдаётся по этому пути.
    s.src = '/sdk.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sdk.js not available'));
    document.head.appendChild(s);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const FAKE_AD_SECONDS = 2;

function fakeAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'fake-ad';
    const label = document.createElement('div');
    box.append(label);
    document.body.append(box);
    let left = FAKE_AD_SECONDS;
    const tick = () => {
      label.textContent = `Здесь будет реклама Яндекса · ${left}`;
      if (left-- <= 0) {
        box.remove();
        resolve(true);
      } else {
        setTimeout(tick, 1000);
      }
    };
    tick();
  });
}

function browserLang(): string {
  return (navigator.language || 'ru').slice(0, 2).toLowerCase();
}

class LocalPlatform implements Platform {
  readonly name = 'local' as const;
  readonly lang = browserLang();
  ready(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async showInterstitial(): Promise<void> {}
  /** Вне Яндекса рекламы нет: показываем заглушку с отсчётом, чтобы сценарий можно было проверить. */
  showRewarded(): Promise<boolean> {
    return fakeAd();
  }
  async loadProgress(): Promise<Progress> {
    return readLocal();
  }
  async saveProgress(p: Progress): Promise<void> {
    writeLocal(p);
  }
  onPause(): void {}
  onResume(): void {}
}

class YandexPlatform implements Platform {
  readonly name = 'yandex' as const;
  readonly lang: string;
  private player: YaPlayer | null = null;

  constructor(private readonly sdk: YaSdk) {
    this.lang = sdk.environment?.i18n?.lang || browserLang();
  }

  ready(): void {
    this.sdk.features.LoadingAPI?.ready();
  }

  gameplayStart(): void {
    this.sdk.features.GameplayAPI?.start();
  }

  gameplayStop(): void {
    this.sdk.features.GameplayAPI?.stop();
  }

  showInterstitial(): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.sdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: () => resolve(),
            onError: () => resolve(),
            onOffline: () => resolve(),
          },
        });
      } catch {
        resolve();
      }
    });
  }

  showRewarded(): Promise<boolean> {
    return new Promise((resolve) => {
      let rewarded = false;
      try {
        this.sdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => {
              rewarded = true;
            },
            onClose: () => resolve(rewarded),
            onError: () => resolve(false),
          },
        });
      } catch {
        resolve(false);
      }
    });
  }

  private async getPlayer(): Promise<YaPlayer | null> {
    if (this.player) return this.player;
    try {
      this.player = await this.sdk.getPlayer({ scope: false });
    } catch {
      this.player = null;
    }
    return this.player;
  }

  async loadProgress(): Promise<Progress> {
    const local = readLocal();
    const player = await this.getPlayer();
    if (!player) return local;
    try {
      const data = await player.getData(['progress']);
      return mergeProgress(local, normalizeProgress(data.progress));
    } catch {
      return local;
    }
  }

  async saveProgress(p: Progress): Promise<void> {
    writeLocal(p);
    const player = await this.getPlayer();
    if (!player) return;
    try {
      await player.setData({ progress: p });
    } catch {
      // Облако недоступно — копия уже в localStorage.
    }
  }

  onPause(cb: () => void): void {
    this.sdk.on?.('game_api_pause', cb);
  }

  onResume(cb: () => void): void {
    this.sdk.on?.('game_api_resume', cb);
  }
}

export async function initPlatform(): Promise<Platform> {
  try {
    await withTimeout(loadSdkScript(), SDK_TIMEOUT_MS);
    if (!window.YaGames) throw new Error('YaGames missing');
    const sdk = await withTimeout(window.YaGames.init(), SDK_TIMEOUT_MS);
    return new YandexPlatform(sdk);
  } catch {
    return new LocalPlatform();
  }
}
