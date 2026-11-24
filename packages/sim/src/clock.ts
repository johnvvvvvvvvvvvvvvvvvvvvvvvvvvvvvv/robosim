/**
 * ساعة الخطوة الثابتة (Fixed Timestep Accumulator).
 * تحوّل الزمن الحقيقي المنقضي إلى عدد صحيح من خطوات الفيزياء.
 * - speed: مضاعف السرعة (1 = زمن حقيقي)
 * - maxStepsPerTick: حماية من "دوامة الموت" إن تأخر الجهاز؛ الفائض يُهمل (المحاكاة تبطؤ)
 */
export class FixedStepClock {
  private accumulator = 0;
  private paused = false;
  private pendingSteps = 0;
  private speedMultiplier = 1;

  constructor(
    readonly stepSeconds: number,
    readonly maxStepsPerTick = 20,
    private readonly maxFrameSeconds = 0.25,
  ) {
    if (!(stepSeconds > 0)) throw new RangeError('stepSeconds must be > 0');
  }

  get speed(): number {
    return this.speedMultiplier;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setSpeed(multiplier: number): void {
    if (!(multiplier > 0 && multiplier <= 100)) {
      throw new RangeError(`speed must be in (0, 100], got ${multiplier}`);
    }
    this.speedMultiplier = multiplier;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** يطلب خطوة واحدة تُنفَّذ حتى لو كانت المحاكاة متوقفة. */
  stepOnce(): void {
    this.pendingSteps++;
  }

  reset(): void {
    this.accumulator = 0;
    this.pendingSteps = 0;
  }

  /** يرجع عدد الخطوات الواجب تنفيذها بعد مرور realSeconds من الزمن الحقيقي. */
  advance(realSeconds: number): number {
    let steps = this.pendingSteps;
    this.pendingSteps = 0;
    if (this.paused) return steps;

    this.accumulator += Math.min(Math.max(realSeconds, 0), this.maxFrameSeconds) * this.speedMultiplier;
    const due = Math.floor(this.accumulator / this.stepSeconds + 1e-9);
    this.accumulator = Math.max(0, this.accumulator - due * this.stepSeconds);
    steps += Math.min(due, this.maxStepsPerTick);
    return steps;
  }
}
