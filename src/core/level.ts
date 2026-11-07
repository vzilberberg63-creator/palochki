import { GrainKindId, LOOKALIKES, UNLOCK_ORDER } from './grains';
import { Rng, levelSeed } from './rng';

/** Параметры одного уровня. Всё, что влияет на сложность, собрано здесь. */
export interface LevelConfig {
  /** Номер уровня, начиная с 1. */
  index: number;
  seed: number;
  /** Виды, для которых есть лоток: их надо рассортировать. */
  targets: GrainKindId[];
  /** Виды-наполнители: остаются на столе, их класть в лотки нельзя. */
  fillers: GrainKindId[];
  /** Количество зёрен каждого вида. */
  counts: Partial<Record<GrainKindId, number>>;
  /** Лимит времени в секундах, null — без таймера. */
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
}

/** Кривая сложности: 0 на первом уровне, плавно стремится к 1. */
export function difficulty(index: number): number {
  return 1 - Math.exp(-(Math.max(1, index) - 1) / 14);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
  // Таймер включается с 4-го уровня; на зерно со временем отводится всё меньше секунд.
  const timeLimit = index >= 4 ? Math.round(12 + targetGrains * lerp(3.6, 1.7, d)) : null;

  return {
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
  };
}
