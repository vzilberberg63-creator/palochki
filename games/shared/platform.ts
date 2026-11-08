/**
 * Обёртка над Yandex Games SDK, общая для мини-игр.
 * На хостинге Яндекса работает с SDK, локально и в превью — с заглушкой,
 * поэтому игры можно запускать и проверять без Яндекса.
 */

export interface Platform {
  readonly name: 'yandex' | 'local';
  readonly lang: string;
  ready(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  showInterstitial(): Promise<void>;
  /** true — игрок досмотрел рекламу и награду надо выдать. */
  showRewarded(): Promise<boolean>;
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
}

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
    showFullscreenAdv(opts: { callbacks: { onClose?: () => void; onError?: () => void; onOffline?: () => void } }): void;
    showRewardedVideo(opts: {
      callbacks: { onRewarded?: () => void; onClose?: () => void; onError?: () => void };
    }): void;
  };
  getPlayer(opts?: { scope?: boolean }): Promise<YaPlayer>;
  on?(event: 'game_api_pause' | 'game_api_resume', cb: () => void): void;
}

/** SDK кладёт себя в window.YaGames. Без глобального объявления, чтобы не спорить с типами других игр. */
function yaGames(): { init(): Promise<YaSdk> } | undefined {
  return (window as unknown as { YaGames?: { init(): Promise<YaSdk> } }).YaGames;
}

const SDK_TIMEOUT_MS = 4000;
const FAKE_AD_SECONDS = 2;

function browserLang(): string {
  return (navigator.language || 'ru').slice(0, 2).toLowerCase();
}

function readLocal<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Хранилище недоступно — игра продолжается без сохранения.
  }
}

/** Вне Яндекса вместо рекламы — двухсекундная заглушка, чтобы сценарий можно было пройти. */
function fakeAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'fake-ad';
    document.body.append(box);
    let left = FAKE_AD_SECONDS;
    const tick = () => {
      box.textContent = `Здесь будет реклама Яндекса · ${left}`;
      if (left-- <= 0) {
        box.remove();
        resolve(true);
      } else setTimeout(tick, 1000);
    };
    tick();
  });
}

class LocalPlatform implements Platform {
  readonly name = 'local' as const;
  readonly lang = browserLang();
  ready(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async showInterstitial(): Promise<void> {}
  showRewarded(): Promise<boolean> {
    return fakeAd();
  }
  async load<T>(key: string): Promise<T | null> {
    return readLocal<T>(key);
  }
  async save<T>(key: string, value: T): Promise<void> {
    writeLocal(key, value);
  }
  onPause(): void {}
  onResume(): void {}
}

class YandexPlatform implements Platform {
  readonly name = 'yandex' as const;
  readonly lang: string;
  private player: Promise<YaPlayer | null> | null = null;

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
        this.sdk.adv.showFullscreenAdv({ callbacks: { onClose: () => resolve(), onError: () => resolve(), onOffline: () => resolve() } });
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

  private getPlayer(): Promise<YaPlayer | null> {
    this.player ??= this.sdk.getPlayer({ scope: false }).catch(() => null);
    return this.player;
  }

  /** Облако Яндекса, а если его нет — localStorage. */
  async load<T>(key: string): Promise<T | null> {
    const local = readLocal<T>(key);
    const player = await this.getPlayer();
    if (!player) return local;
    try {
      const data = await player.getData([key]);
      return (data[key] as T | undefined) ?? local;
    } catch {
      return local;
    }
  }

  async save<T>(key: string, value: T): Promise<void> {
    writeLocal(key, value);
    const player = await this.getPlayer();
    if (!player) return;
    try {
      await player.setData({ [key]: value as unknown });
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

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (yaGames()) return resolve();
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
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

export async function initPlatform(): Promise<Platform> {
  try {
    await withTimeout(loadSdkScript(), SDK_TIMEOUT_MS);
    const ya = yaGames();
    if (!ya) throw new Error('YaGames missing');
    return new YandexPlatform(await withTimeout(ya.init(), SDK_TIMEOUT_MS));
  } catch {
    return new LocalPlatform();
  }
}

/** Русский для стран СНГ, остальным английский. */
export function isRussian(lang: string): boolean {
  return ['ru', 'be', 'kk', 'uk', 'uz'].includes(lang);
}
