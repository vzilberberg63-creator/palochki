/**
 * Звук без аудиофайлов: всё синтезируется через Web Audio API.
 *
 * - деревянный стук палочек при захвате;
 * - стук зерна о лоток и нота пентатоники: чем ближе конец уровня, тем выше нота,
 *   поэтому сортировка складывается в мелодию;
 * - глухой удар при ошибке, дребезг при выскальзывании;
 * - непрерывный шорох при разгребании кучи, громкость от скорости и числа задетых зёрен;
 * - короткие мелодии победы и проигрыша, щелчок кнопок.
 *
 * Требования Яндекс Игр: звук выключается на паузе, при сворачивании вкладки и во время рекламы
 * (см. setSuspended), у игрока есть кнопка выключения звука.
 */

export type SoundName =
  | 'grab'
  | 'sorted'
  | 'combo'
  | 'comboLost'
  | 'timeBonus'
  | 'wrong'
  | 'slipped'
  | 'won'
  | 'lost'
  | 'tick'
  | 'coins'
  | 'purchase'
  | 'ui';

export interface PlayOptions {
  /** Для 'sorted': доля разобранного, от 0 до 1. Определяет высоту ноты. */
  progress?: number;
  /** Для 'combo': новый множитель, от него зависит высота аккорда. */
  multiplier?: number;
  /** Для 'tick': сколько секунд осталось; последние три тикают выше и громче. */
  secondsLeft?: number;
}

/** Ре-минорная пентатоника на две октавы (Гц): D4 F4 G4 A4 C5 D5 F5 G5 A5 C6 D6. */
const PENTATONIC = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66];

const MASTER_VOLUME = 0.8;
const RAKE_MAX_GAIN = 0.11;

type CtxFactory = () => BaseAudioContext | null;

function defaultContext(): BaseAudioContext | null {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export class Sound {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rakeGain: GainNode | null = null;
  private rakeFilter: BiquadFilterNode | null = null;
  private muted = false;
  /** Причины, по которым звук сейчас приостановлен: пауза, скрытая вкладка, реклама. */
  private readonly suspendReasons = new Set<string>();

  constructor(private readonly makeContext: CtxFactory = defaultContext) {}

  /**
   * Браузеры разрешают звук только после действия игрока,
   * поэтому контекст создаётся и возобновляется из обработчика нажатия.
   */
  unlock(): void {
    if (!this.ctx) this.init();
    this.applySuspend();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.02);
    }
  }

  /** Приостановить или возобновить звук по причине reason (их может быть несколько сразу). */
  setSuspended(reason: string, suspended: boolean): void {
    if (suspended) this.suspendReasons.add(reason);
    else this.suspendReasons.delete(reason);
    this.applySuspend();
  }

  /** Громкость шороха разгребания, 0..1. Вызывается каждый кадр. */
  setRake(activity: number): void {
    if (!this.ctx || !this.rakeGain || !this.rakeFilter) return;
    const a = Math.max(0, Math.min(1, activity));
    const t = this.ctx.currentTime;
    this.rakeGain.gain.setTargetAtTime(a * RAKE_MAX_GAIN, t, 0.04);
    // Чем быстрее разгребаешь, тем ярче шорох.
    this.rakeFilter.frequency.setTargetAtTime(2200 + a * 2600, t, 0.05);
  }

  play(name: SoundName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || this.suspendReasons.size > 0) return;
    const t = ctx.currentTime + 0.005;
    switch (name) {
      case 'grab':
        // Два кончика палочек сходятся: двойной сухой щелчок.
        this.click(t, 2600 * vary(0.06), 0.035, 0.5);
        this.click(t + 0.022, 3300 * vary(0.06), 0.03, 0.35);
        break;
      case 'sorted': {
        this.click(t, 1300 * vary(0.08), 0.05, 0.45);
        const p = Math.max(0, Math.min(1, opts.progress ?? 0));
        const note = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.floor(p * (PENTATONIC.length - 1)))];
        this.pluck(t + 0.01, note, 0.55, 0.5);
        break;
      }
      case 'combo': {
        // Множитель вырос: быстрый восходящий аккорд, выше с каждым множителем.
        const base = Math.min(4, Math.max(2, opts.multiplier ?? 2)) - 2;
        [0, 2, 4].forEach((step, i) =>
          this.pluck(t + 0.06 + i * 0.05, PENTATONIC[Math.min(PENTATONIC.length - 1, base * 2 + step + 2)], 0.6, 0.22),
        );
        break;
      }
      case 'comboLost':
        // Серия оборвалась: мягкая нисходящая пара нот.
        this.pluck(t, PENTATONIC[3], 0.25, 0.12, 'sine', 1800);
        this.pluck(t + 0.09, PENTATONIC[1], 0.35, 0.12, 'sine', 1800);
        break;
      case 'timeBonus':
        // Звон колокольчика: высокая чистая нота с обертоном.
        this.pluck(t + 0.12, PENTATONIC[10], 0.7, 0.16, 'sine', 6000);
        this.pluck(t + 0.12, PENTATONIC[10] * 2.01, 0.4, 0.05, 'sine', 8000);
        break;
      case 'wrong':
        this.thud(t);
        this.pluck(t + 0.02, 155.56, 0.3, 0.12, 'square', 900);
        break;
      case 'slipped':
        // Зерно скачет по столу: несколько затухающих щелчков.
        for (let i = 0; i < 3; i++) {
          this.click(t + i * 0.05 + Math.random() * 0.015, 2000 + Math.random() * 900, 0.025, 0.3 * (1 - i * 0.28));
        }
        break;
      case 'won':
        [0, 2, 4, 6, 7].forEach((n, i) => this.pluck(t + i * 0.09, PENTATONIC[n], 0.9, 0.2));
        this.pluck(t + 0.5, PENTATONIC[4], 1.6, 0.14);
        this.pluck(t + 0.5, PENTATONIC[7], 1.6, 0.14);
        this.pluck(t + 0.5, PENTATONIC[9], 1.6, 0.12);
        break;
      case 'lost':
        this.pluck(t, PENTATONIC[4], 0.5, 0.2);
        this.pluck(t + 0.22, PENTATONIC[2], 0.5, 0.2);
        this.pluck(t + 0.44, PENTATONIC[0] / 2, 1.1, 0.22);
        break;
      case 'ui':
        this.click(t, 1800, 0.03, 0.5);
        break;
      case 'tick': {
        // Часы: «тик-так» деревянным щелчком; на последних секундах выше и с тоном.
        const sec = opts.secondsLeft ?? 10;
        const last = sec <= 3;
        this.click(t, sec % 2 === 0 ? 1500 : 1150, 0.04, last ? 0.7 : 0.45);
        if (last) this.pluck(t, 880, 0.12, 0.12, 'sine', 4000);
        break;
      }
      case 'coins':
        // Монеты сыплются: несколько звонких нот вразнобой.
        for (let i = 0; i < 5; i++) {
          const f = PENTATONIC[7 + (i % 4)] * vary(0.01);
          this.pluck(t + i * 0.055 + Math.random() * 0.02, f, 0.35, 0.1, 'sine', 7000);
        }
        break;
      case 'purchase':
        this.click(t, 2400, 0.03, 0.4);
        [4, 6, 9].forEach((n, i) => this.pluck(t + 0.05 + i * 0.07, PENTATONIC[n], 0.7, 0.18));
        break;
    }
  }

  // ——— внутреннее ———

  private init(): void {
    const ctx = this.makeContext();
    if (!ctx) return;
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    // Компрессор не даёт наложившимся звукам хрипеть.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const len = Math.floor(ctx.sampleRate * 1.5);
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    // Шорох: бесконечный шум через полосовой фильтр, громкость по умолчанию 0.
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(hp).connect(g).connect(master);
    src.start();
    this.rakeGain = g;
    this.rakeFilter = bp;
  }

  private applySuspend(): void {
    const ctx = this.ctx;
    // OfflineAudioContext (в проверках) приостанавливать не нужно.
    if (!ctx || 'startRendering' in ctx) return;
    const live = ctx as AudioContext;
    const want = this.suspendReasons.size > 0 ? 'suspended' : 'running';
    if (want === 'running' && live.state !== 'running') void live.resume().catch(() => {});
    if (want === 'suspended' && live.state === 'running') void live.suspend().catch(() => {});
  }

  /** Короткий щелчок: всплеск шума через узкий фильтр. Дерево, зерно, кнопки. */
  private click(t: number, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // Узкий фильтр съедает почти всю энергию шума, поэтому усиление большое.
    g.gain.exponentialRampToValueAtTime(gain * 10, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.2, dur + 0.02);
  }

  /** Щипок струны: треугольная волна с обертоном и быстрым затуханием. */
  private pluck(
    t: number,
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'triangle',
    cutoff = 3200,
  ): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff / 4), t + dur);
    lp.connect(g).connect(this.master!);

    for (const [mult, level] of [
      [1, 1],
      [2, 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Глухой удар: низкий тон с падающей высотой и немного шума. */
  private thud(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.25);
    this.click(t, 400, 0.08, 0.3);
  }
}

/** Небольшой случайный разброс, чтобы одинаковые звуки не звучали механически. */
function vary(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}
