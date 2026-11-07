import { GrainKindId, LOOKALIKES, UNLOCK_ORDER } from './grains';
import { Rng, levelSeed } from './rng';

/** Параметры одного уровня. Всё, что влияет на сложность, собрано здесь. */
export type GameMode = 'heap' | 'pick';

export interface LevelConfig {
  /**
   * Режим: heap — палочки прижаты к столу и сгребают зёрна кучками в копилки (как в ролике);
   * pick — палочки берут по одному зерну и переносят в лоток.
   */
  mode: GameMode;
  /** Номер уровня, начиная с 1. */
  index: number;
  seed: number;
  /** Виды, для которых есть лоток: их надо рассортировать. */
  targets: GrainKindId[];
  /** Виды-наполнители: остаются на столе, их класть в лотки нельзя. */
  fillers: GrainKindId[];
  /** Количество зёрен каждого вида. */
  counts: Partial<Record<GrainKindId, number>>;
  /** Лимит времени в секундах, null — без таймера (сейчас таймер есть у всех уровней). */
  timeLimit: number | null;
  /** Масштаб зёрен: меньше — мельче и труднее попасть. */
  sizeScale: number;
  /** Насколько быстро гасится скорость зёрен (1/с). Меньше — «скользкий» стол. */
  damping: number;
  /** Радиус захвата вокруг кончиков палочек. */
  grabRadius: number;
  /** Амплитуда дрожания палочек (единицы мира). */
  jitter: number;
  /** Склонность зерна выскальзывать при быстром движении. */
  slip: number;
  /** Радиус кучи в начале уровня. */
  pileRadius: number;
  /** Режим heap: половина ширины «лопатки» из кончиков палочек. */
  bladeHalfWidth: number;
}

/** Кривая сложности: 0 на первом уровне, плавно стремится к 1. */
export function difficulty(index: number): number {
  return 1 - Math.exp(-(Math.max(1, index) - 1) / 14);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Секунд на зерно на обучающих уровнях: время есть, но спешить можно не сильно. */
const TUTORIAL_SECONDS_PER_GRAIN = 5;

/** Первые уровни задаём вручную как обучение, дальше генерация. */
const TUTORIAL: Record<number, Pick<LevelConfig, 'targets' | 'fillers' | 'counts'>> = {
  1: { targets: ['riceBlack'], fillers: ['riceWhite'], counts: { riceBlack: 6, riceWhite: 40 } },
  2: { targets: ['riceBlack'], fillers: ['riceWhite'], counts: { riceBlack: 12, riceWhite: 70 } },
  3: {
    targets: ['riceBlack', 'riceWhite'],
    fillers: [],
    counts: { riceBlack: 12, riceWhite: 14 },
  },
};

export function generateLevel(index: number): LevelConfig {
  if (!Number.isInteger(index) || index < 1) throw new Error(`bad level index: ${index}`);
  const seed = levelSeed(index);
  const rng = new Rng(seed);
  const d = difficulty(index);

  let targets: GrainKindId[];
  let fillers: GrainKindId[];
  let counts: Partial<Record<GrainKindId, number>>;

  const tutorial = TUTORIAL[index];
  if (tutorial) {
    ({ targets, fillers } = tutorial);
    counts = { ...tutorial.counts };
  } else {
    // Каждые три уровня открывается новый вид зерна.
    const unlocked = UNLOCK_ORDER.slice(0, Math.min(UNLOCK_ORDER.length, 2 + Math.floor((index - 1) / 3)));
    const newest = unlocked[unlocked.length - 1];
    const targetCount = Math.min(4, 1 + Math.floor((index - 1) / 4), unlocked.length);

    // Самый новый вид всегда среди целей, чтобы игрок с ним познакомился.
    const pool = rng.shuffle(unlocked.filter((k) => k !== newest));
    targets = [newest, ...pool.slice(0, targetCount - 1)];

    const rest = unlocked.filter((k) => !targets.includes(k));
    fillers = rng.shuffle([...rest]).slice(0, d > 0.5 ? 3 : 2);

    // На высокой сложности подмешиваем «двойника» хотя бы одной цели.
    if (d > 0.35) {
      for (const t of targets) {
        const twin = LOOKALIKES[t];
        if (twin && unlocked.includes(twin) && !targets.includes(twin) && !fillers.includes(twin)) {
          fillers.push(twin);
          break;
        }
      }
    }

    const total = Math.round(lerp(70, 340, d));
    const targetShare = lerp(0.3, 0.2, d);
    const perTarget = Math.max(4, Math.round((total * targetShare) / targets.length));
    const fillerTotal = fillers.length > 0 ? total - perTarget * targets.length : 0;
    const perFiller = fillers.length > 0 ? Math.floor(fillerTotal / fillers.length) : 0;

    counts = {};
    for (const t of targets) counts[t] = perTarget + rng.int(-1, 2);
    for (const f of fillers) counts[f] = perFiller;
  }

  const targetGrains = targets.reduce((s, k) => s + (counts[k] ?? 0), 0);
  // Таймер на каждом уровне. На обучении он щедрый, дальше на зерно отводится всё меньше секунд.
  const perGrain = TUTORIAL[index] ? TUTORIAL_SECONDS_PER_GRAIN : lerp(3.6, 1.7, d);
  const timeLimit = Math.round(12 + targetGrains * perGrain);

  return {
    mode: 'pick',
    index,
    seed,
    targets,
    fillers,
    counts,
    timeLimit,
    sizeScale: lerp(1.25, 0.8, d),
    damping: lerp(9, 2.5, d),
    grabRadius: lerp(26, 12, d),
    jitter: index >= 8 ? lerp(0, 9, d) : 0,
    slip: index >= 10 ? lerp(0, 0.6, d) : 0,
    pileRadius: lerp(150, 270, d),
    bladeHalfWidth: 0,
  };
}

/** Обучение режима «Кучки»: как в ролике — сначала чёрный рис из белого. */
const HEAP_TUTORIAL: Record<number, Pick<LevelConfig, 'targets' | 'fillers' | 'counts'>> = {
  1: { targets: ['riceBlack'], fillers: ['riceWhite'], counts: { riceBlack: 10, riceWhite: 45 } },
  2: { targets: ['riceBlack'], fillers: ['riceWhite'], counts: { riceBlack: 18, riceWhite: 80 } },
  3: { targets: ['riceBlack', 'riceWhite'], fillers: [], counts: { riceBlack: 20, riceWhite: 20 } },
};

/**
 * Уровни режима «Кучки». Зёрна не берут по одному, поэтому их больше, а секунд на зерно меньше.
 * Копилок не больше трёх: они стоят прямо на столе и занимают место.
 * Сложность: больше видов и зёрен, мельче зёрна, уже лопатка, «скользкий» стол
 * (кучка рассыпается, если толкать резко), меньше времени.
 */
export function generateHeapLevel(index: number): LevelConfig {
  if (!Number.isInteger(index) || index < 1) throw new Error(`bad level index: ${index}`);
  // Свой seed, чтобы уровни режимов не совпадали.
  const seed = levelSeed(index + 5000);
  const rng = new Rng(seed);
  const d = difficulty(index);

  let targets: GrainKindId[];
  let fillers: GrainKindId[];
  let counts: Partial<Record<GrainKindId, number>>;

  const tutorial = HEAP_TUTORIAL[index];
  if (tutorial) {
    ({ targets, fillers } = tutorial);
    counts = { ...tutorial.counts };
  } else {
    const unlocked = UNLOCK_ORDER.slice(0, Math.min(UNLOCK_ORDER.length, 2 + Math.floor((index - 1) / 3)));
    const newest = unlocked[unlocked.length - 1];
    const targetCount = Math.min(3, 1 + Math.floor((index - 1) / 5), unlocked.length);
    const pool = rng.shuffle(unlocked.filter((k) => k !== newest));
    targets = [newest, ...pool.slice(0, targetCount - 1)];
    const rest = unlocked.filter((k) => !targets.includes(k));
    fillers = rng.shuffle([...rest]).slice(0, d > 0.5 ? 3 : 2);
    if (d > 0.35) {
      for (const t of targets) {
        const twin = LOOKALIKES[t];
        if (twin && unlocked.includes(twin) && !targets.includes(twin) && !fillers.includes(twin)) {
          fillers.push(twin);
          break;
        }
      }
    }
    const total = Math.round(lerp(90, 300, d));
    const perTarget = Math.max(8, Math.round((total * lerp(0.25, 0.18, d)) / targets.length));
    const perFiller = fillers.length > 0 ? Math.floor((total - perTarget * targets.length) / fillers.length) : 0;
    counts = {};
    for (const t of targets) counts[t] = perTarget + rng.int(-1, 2);
    for (const f of fillers) counts[f] = perFiller;
  }

  const targetGrains = targets.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const perGrain = tutorial ? 3.5 : lerp(2.6, 1.1, d);
  return {
    mode: 'heap',
    index,
    seed,
    targets,
    fillers,
    counts,
    timeLimit: Math.round(20 + targetGrains * perGrain),
    sizeScale: lerp(1.2, 0.85, d),
    // Высокое трение — зёрна ведут себя как крупа: останавливаются, как только лопатка встала.
    damping: lerp(16, 7, d),
    grabRadius: 0,
    jitter: 0,
    slip: 0,
    pileRadius: lerp(140, 240, d),
    bladeHalfWidth: lerp(56, 38, d),
  };
}

export function generateLevelFor(mode: GameMode, index: number): LevelConfig {
  return mode === 'heap' ? generateHeapLevel(index) : generateLevel(index);
}
