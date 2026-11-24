export interface QualityLevel {
  /** السقف الأعلى لـ devicePixelRatio. */
  pixelRatioCap: number;
  /** حجم خريطة الظل (0 = بدون ظلال). */
  shadowMapSize: number;
}

/** من الأعلى جودة (0) إلى الأخف (آخر عنصر). */
export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { pixelRatioCap: 2, shadowMapSize: 2048 },
  { pixelRatioCap: 1.5, shadowMapSize: 1024 },
  { pixelRatioCap: 1, shadowMapSize: 1024 },
  { pixelRatioCap: 1, shadowMapSize: 0 },
  { pixelRatioCap: 0.75, shadowMapSize: 0 },
];

export interface AdaptiveQualityOptions {
  lowFps: number; // دون هذا المعدل نخفّض الجودة
  highFps: number; // فوق هذا المعدل نرفعها
  lowAfterMs: number;
  highAfterMs: number;
  cooldownMs: number;
}

const DEFAULTS: AdaptiveQualityOptions = {
  lowFps: 45,
  highFps: 57,
  lowAfterMs: 1500,
  highAfterMs: 8000,
  cooldownMs: 2500,
};

/**
 * ضبط الجودة تلقائياً حسب معدل الإطارات (مع تباطؤ في الرفع لتفادي التذبذب).
 * sample() يرجع المستوى الجديد عند التغيير، وإلا null.
 */
export class AdaptiveQuality {
  private emaMs = 16.7;
  private lowMs = 0;
  private highMs = 0;
  private sinceChangeMs = 0;
  private locked = false;
  private current: number;
  private readonly opts: AdaptiveQualityOptions;

  constructor(
    startLevel = 0,
    private readonly maxLevel = QUALITY_LEVELS.length - 1,
    opts: Partial<AdaptiveQualityOptions> = {},
  ) {
    this.current = startLevel;
    this.opts = { ...DEFAULTS, ...opts };
  }

  get level(): number {
    return this.current;
  }

  get fps(): number {
    return 1000 / this.emaMs;
  }

  /** عند التثبيت اليدوي يتوقف الضبط التلقائي. */
  setLocked(locked: boolean): void {
    this.locked = locked;
    this.lowMs = 0;
    this.highMs = 0;
  }

  setLevel(level: number): void {
    this.current = Math.max(0, Math.min(this.maxLevel, level));
    this.lowMs = 0;
    this.highMs = 0;
    this.sinceChangeMs = 0;
  }

  sample(frameMs: number): number | null {
    // تجاهل الإطارات الشاذة (تبويب في الخلفية أو توقف)
    if (!(frameMs > 0) || frameMs > 250) return null;
    this.emaMs += (frameMs - this.emaMs) * 0.05;
    this.sinceChangeMs += frameMs;
    if (this.locked || this.sinceChangeMs < this.opts.cooldownMs) return null;

    const fps = this.fps;
    if (fps < this.opts.lowFps) {
      this.lowMs += frameMs;
      this.highMs = 0;
      if (this.lowMs >= this.opts.lowAfterMs && this.current < this.maxLevel) {
        this.setLevel(this.current + 1);
        return this.current;
      }
    } else if (fps >= this.opts.highFps) {
      this.highMs += frameMs;
      this.lowMs = 0;
      if (this.highMs >= this.opts.highAfterMs && this.current > 0) {
        this.setLevel(this.current - 1);
        return this.current;
      }
    } else {
      this.lowMs = 0;
      this.highMs = 0;
    }
    return null;
  }
}
