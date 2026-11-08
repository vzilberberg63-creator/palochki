/**
 * Маленький синтезатор на Web Audio: щелчки, ноты, шум. Аудиофайлов нет.
 * Звук запускается после первого действия игрока и молчит на паузе, в фоне и во время рекламы.
 */

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private readonly reasons = new Set<string>();
  private loops = new Map<string, { gain: GainNode; filter: BiquadFilterNode }>();

  unlock(): void {
    if (!this.ctx) this.init();
    this.apply();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  setSuspended(reason: string, on: boolean): void {
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.apply();
  }

  private get silent(): boolean {
    return !this.ctx || !this.master || this.muted || this.reasons.size > 0;
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    this.master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private apply(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.reasons.size > 0 && ctx.state === 'running') void ctx.suspend().catch(() => {});
    if (this.reasons.size === 0 && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  /** Короткий щелчок шума через полосовой фильтр: стук, хруст, кнопка. */
  click(freq: number, dur = 0.04, gain = 0.4, delay = 0): void {
    if (this.silent) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005 + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * 10, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random(), dur + 0.02);
  }

  /** Нота: треугольник или синус с затуханием. */
  note(freq: number, dur = 0.5, gain = 0.25, delay = 0, type: OscillatorType = 'triangle'): void {
    if (this.silent) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005 + delay;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Глухой удар с падающей высотой. */
  thud(gain = 0.5): void {
    if (this.silent) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.3);
  }

  /**
   * Непрерывный шум (журчание, ветер). level — громкость 0..1, вызывается каждый кадр.
   * freq — центр полосы, задаёт характер звука.
   */
  loop(id: string, level: number, freq: number, q = 1): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    let l = this.loops.get(id);
    if (!l) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      l = { gain, filter };
      this.loops.set(id, l);
    }
    l.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.25, ctx.currentTime, 0.05);
    l.filter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
  }
}

/** Пентатоника для приятных «наградных» нот. */
export const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0, 1046.5];
