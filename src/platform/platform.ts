/**
 * Обёртка над Yandex Games SDK. Игра работает только через этот интерфейс,
 * поэтому локально (без SDK) всё продолжает работать на заглушке.
 *
 * Документация SDK: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 */

export interface Progress {
  /** Максимальный открытый уровень. */
  unlocked: number;
  /** Лучшее количество звёзд по уровням. */
  stars: Record<number, number>;
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
  loadProgress(): Promise<Progress>;
  saveProgress(p: Progress): Promise<void>;
  /** Платформа просит поставить игру на паузу (например, открылось окно Яндекса). */
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
}

export const EMPTY_PROGRESS: Progress = { unlocked: 1, stars: {} };
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
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROGRESS, stars: {} };
  const r = raw as Partial<Progress>;
  const unlocked = Number.isInteger(r.unlocked) && (r.unlocked as number) >= 1 ? (r.unlocked as number) : 1;
  const stars: Record<number, number> = {};
  if (r.stars && typeof r.stars === 'object') {
    for (const [k, v] of Object.entries(r.stars)) {
      const lvl = Number(k);
      if (Number.isInteger(lvl) && lvl >= 1 && typeof v === 'number' && v >= 0 && v <= 3) stars[lvl] = v;
    }
  }
  return { unlocked, stars };
}

function readLocal(): Progress {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return normalizeProgress(s ? JSON.parse(s) : null);
  } catch {
    return { ...EMPTY_PROGRESS, stars: {} };
  }
}

function writeLocal(p: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Хранилище недоступно (приватный режим) — игра продолжается без сохранения.
  }
}

/** Из двух копий прогресса берём ту, где игрок продвинулся дальше. */
function mergeProgress(a: Progress, b: Progress): Progress {
  const stars: Record<number, number> = { ...a.stars };
  for (const [k, v] of Object.entries(b.stars)) {
    const lvl = Number(k);
    stars[lvl] = Math.max(stars[lvl] ?? 0, v);
  }
  return { unlocked: Math.max(a.unlocked, b.unlocked), stars };
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
