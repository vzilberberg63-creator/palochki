/** Настройки игрока, которые хранятся только в этом браузере. */
export interface Settings {
  muted: boolean;
}

const KEY = 'palochki.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    return { muted: raw?.muted === true };
  } catch {
    return { muted: false };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Хранилище недоступно — настройка действует до перезагрузки.
  }
}
