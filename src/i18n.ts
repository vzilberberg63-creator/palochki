import type { GrainKindId } from './core/grains';
import type { GameMode } from './core/level';
import type { SkinId } from './core/skins';

type Dict = {
  title: string;
  play: string;
  continue: string;
  level: string;
  levelShort: string;
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
  heapGoal: (kinds: string) => string;
  heapHint: string;
  heapMouseHint: string;
  intruderHint: string;
  modes: Record<GameMode, string>;
  modeDesc: Record<GameMode, string>;
  grains: Record<GrainKindId, string>;
};

const ru: Dict = {
  title: 'Палочки',
  play: 'Играть',
  continue: 'Продолжить',
  level: 'Уровень',
  levelShort: 'Ур.',
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
  heapGoal: (k) => `Сгребите в копилки: ${k}`,
  heapHint:
    'Прижмите палочки к столу и ведите — они сгребают зёрна, как лопатка. Отделите нужные зёрна от кучи и столкните кучкой в копилку. Чужое зерно в копилке — нажмите на него, и палочки его выбросят.',
  intruderHint: 'В копилке чужие зёрна — нажмите на них, чтобы выбросить',
  heapMouseHint: 'Левая кнопка мыши — левая палочка, правая — правая. Одной палочкой удобно отделять зёрна, двумя — сталкивать кучку.',
  modes: { heap: 'Кучки', pick: 'По зёрнышку' },
  modeDesc: { heap: 'сгребать палочками', pick: 'брать по одному' },
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
  levelShort: 'Lv',
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
  heapGoal: (k) => `Sweep into the bins: ${k}`,
  heapHint:
    'Press the chopsticks to the table and drag: they sweep grains like a scraper. Split the right grains off the pile and push them into the bin as a heap. Tap a foreign grain in a bin to toss it out.',
  intruderHint: 'Foreign grains in a bin: tap them to toss them out',
  heapMouseHint: 'Left mouse button is the left chopstick, right button the right one. One stick splits grains apart, both push a heap.',
  modes: { heap: 'Heaps', pick: 'One by one' },
  modeDesc: { heap: 'sweep with chopsticks', pick: 'pick grains one at a time' },
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
