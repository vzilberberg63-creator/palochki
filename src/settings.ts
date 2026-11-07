/** Настройки игрока, которые хранятся только в этом браузере. */
import type { GameMode } from './core/level';

export interface Settings {
  muted: boolean;
  /** Последний выбранный режим. */
  mode: GameMode;
}

const KEY = 'palochki.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    return { muted: raw?.muted === true, mode: raw?.mode === 'pick' ? 'pick' : 'heap' };
  } catch {
    return { muted: false, mode: 'heap' };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Хранилище недоступно — настройка действует до перезагрузки.
  }
}
