import type { GrainKindId } from './core/grains';
import type { SkinId } from './core/skins';

type Dict = {
  title: string;
  play: string;
  continue: string;
  level: string;
  next: string;
  retry: string;
  menu: string;
  resume: string;
  restart: string;
  paused: string;
  won: string;
  lost: string;
  mistakes: string;
  soundOn: string;
  soundOff: string;
  combo: string;
  score: string;
  bestCombo: string;
  record: string;
  timeBonus: (s: number) => string;
  coins: string;
  shop: string;
  shopHint: string;
  select: string;
  selected: string;
  back: string;
  notEnough: (n: number) => string;
  continueAd: (s: number) => string;
  doubleCoinsAd: (m: number) => string;
  shopAdCoins: (n: number) => string;
  skins: Record<SkinId, string>;
  hint: string;
  levelGoal: (kinds: string) => string;
  grains: Record<GrainKindId, string>;
};

const ru: Dict = {
  title: 'Палочки',
  play: 'Играть',
  continue: 'Продолжить',
  level: 'Уровень',
  next: 'Дальше',
  retry: 'Ещё раз',
  menu: 'Меню',
  resume: 'Продолжить',
  restart: 'Заново',
  paused: 'Пауза',
  won: 'Разобрано!',
  lost: 'Время вышло',
  mistakes: 'Ошибки',
  combo: 'комбо',
  score: 'Очки',
  bestCombo: 'Лучшее комбо',
  record: 'Новый рекорд!',
  timeBonus: (n) => `+${n} с`,
  coins: 'Монеты',
  shop: 'Магазин палочек',
  shopHint: 'Стиль меняет только вид палочек, на сложность он не влияет.',
  select: 'Выбрать',
  selected: 'Выбрано',
  back: 'Назад',
  notEnough: (n) => `Не хватает ${n}`,
  continueAd: (n) => `▶ +${n} секунд за рекламу`,
  doubleCoinsAd: (m) => `▶ Монеты ×${m} за рекламу`,
  shopAdCoins: (n) => `▶ +${n} монет за рекламу`,
  skins: {
    classic: 'Классические',
    bamboo: 'Бамбук',
    redLacquer: 'Красный лак',
    steel: 'Сталь',
    sakura: 'Сакура',
    jade: 'Нефрит',
    blackGold: 'Чёрное золото',
    golden: 'Золотые',
  },
  soundOn: 'Звук: вкл',
  soundOff: 'Звук: выкл',
  hint: 'Нажмите на зерно, чтобы взять его палочками, и отпустите над нужным лотком. Ведите по пустому месту, чтобы разгрести кучу.',
  levelGoal: (k) => `Рассортируйте: ${k}`,
  grains: {
    riceWhite: 'белый рис',
    riceBlack: 'чёрный рис',
    buckwheat: 'гречка',
    lentilRed: 'красная чечевица',
    pea: 'горох',
    beanWhite: 'белая фасоль',
    lentilGreen: 'зелёная чечевица',
    beanRed: 'красная фасоль',
  },
};

const en: Dict = {
  title: 'Chopsticks',
  play: 'Play',
  continue: 'Continue',
  level: 'Level',
  next: 'Next',
  retry: 'Retry',
  menu: 'Menu',
  resume: 'Resume',
  restart: 'Restart',
  paused: 'Paused',
  won: 'Sorted!',
  lost: "Time's up",
  mistakes: 'Mistakes',
  combo: 'combo',
  score: 'Score',
  bestCombo: 'Best combo',
  record: 'New record!',
  timeBonus: (n) => `+${n}s`,
  coins: 'Coins',
  shop: 'Chopstick shop',
  shopHint: 'A style only changes how the chopsticks look; it does not affect difficulty.',
  select: 'Select',
  selected: 'Selected',
  back: 'Back',
  notEnough: (n) => `${n} more needed`,
  continueAd: (n) => `▶ +${n} seconds for an ad`,
  doubleCoinsAd: (m) => `▶ Coins ×${m} for an ad`,
  shopAdCoins: (n) => `▶ +${n} coins for an ad`,
  skins: {
    classic: 'Classic',
    bamboo: 'Bamboo',
    redLacquer: 'Red lacquer',
    steel: 'Steel',
    sakura: 'Sakura',
    jade: 'Jade',
    blackGold: 'Black gold',
    golden: 'Golden',
  },
  soundOn: 'Sound: on',
  soundOff: 'Sound: off',
  hint: 'Press on a grain to pick it up with the chopsticks and release it over the matching tray. Drag across empty space to spread the pile.',
  levelGoal: (k) => `Sort: ${k}`,
  grains: {
    riceWhite: 'white rice',
    riceBlack: 'black rice',
    buckwheat: 'buckwheat',
    lentilRed: 'red lentils',
    pea: 'peas',
    beanWhite: 'white beans',
    lentilGreen: 'green lentils',
    beanRed: 'red beans',
  },
};

/** Русский для стран СНГ, как рекомендует Яндекс; остальным — английский. */
const RU_LANGS = new Set(['ru', 'be', 'kk', 'uk', 'uz']);

let current: Dict = ru;

export function setLang(lang: string): void {
  current = RU_LANGS.has(lang) ? ru : en;
  document.documentElement.lang = current === ru ? 'ru' : 'en';
}

export function t(): Dict {
  return current;
}
