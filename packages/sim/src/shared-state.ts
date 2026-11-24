import {
  FLOATS_PER_BODY,
  HeaderIndex,
  computeStateLayout,
  type StateLayout,
} from '@robosim/core';

/**
 * كاتب الحالة المشتركة (يعمل داخل Sim Worker فقط).
 * Seqlock: begin() يجعل التسلسل فردياً، end() يجعله زوجياً.
 * خانة فارغة (جسم محذوف) تُعلَّم بـ NaN في كل القيم.
 */
export class SharedStateWriter {
  readonly layout: StateLayout;
  private readonly header: Int32Array;
  private readonly floats: Float32Array;

  constructor(buffer: SharedArrayBuffer, maxBodies: number) {
    this.layout = computeStateLayout(maxBodies);
    if (buffer.byteLength < this.layout.totalBytes) {
      throw new RangeError('state buffer is smaller than required layout');
    }
    this.header = new Int32Array(buffer, 0, this.layout.headerBytes / 4);
    this.floats = new Float32Array(buffer, this.layout.bodiesByteOffset, maxBodies * FLOATS_PER_BODY);
  }

  begin(): void {
    Atomics.add(this.header, HeaderIndex.Sequence, 1);
  }

  writeBody(
    slot: number,
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    qw: number,
  ): void {
    const o = slot * FLOATS_PER_BODY;
    this.floats[o] = px;
    this.floats[o + 1] = py;
    this.floats[o + 2] = pz;
    this.floats[o + 3] = qx;
    this.floats[o + 4] = qy;
    this.floats[o + 5] = qz;
    this.floats[o + 6] = qw;
  }

  clearBody(slot: number): void {
    const o = slot * FLOATS_PER_BODY;
    this.floats.fill(Number.NaN, o, o + FLOATS_PER_BODY);
  }

  clearAll(): void {
    this.floats.fill(Number.NaN);
  }

  end(bodyCount: number, stepCount: number): void {
    Atomics.store(this.header, HeaderIndex.BodyCount, bodyCount);
    Atomics.store(this.header, HeaderIndex.StepCount, stepCount);
    Atomics.add(this.header, HeaderIndex.Sequence, 1);
  }
}

export interface StateFrame {
  bodyCount: number;
  stepCount: number;
}

/** قارئ الحالة المشتركة (الخيط الرئيسي / الرسم). لا يحجب الكاتب أبداً. */
export class SharedStateReader {
  readonly layout: StateLayout;
  private readonly header: Int32Array;
  private readonly floats: Float32Array;

  constructor(buffer: SharedArrayBuffer, maxBodies: number) {
    this.layout = computeStateLayout(maxBodies);
    this.header = new Int32Array(buffer, 0, this.layout.headerBytes / 4);
    this.floats = new Float32Array(buffer, this.layout.bodiesByteOffset, maxBodies * FLOATS_PER_BODY);
  }

  /** مصفوفة بحجم كافٍ لاستقبال كل الأجسام؛ أعد استخدامها بين الإطارات. */
  createOutput(): Float32Array {
    return new Float32Array(this.layout.maxBodies * FLOATS_PER_BODY);
  }

  /**
   * ينسخ لقطة متسقة إلى out. يرجع null إن لم ينجح بعد عدة محاولات
   * (يعني أن الكاتب مشغول؛ استخدم الإطار السابق).
   */
  read(out: Float32Array, maxAttempts = 8): StateFrame | null {
    if (out.length < this.floats.length) throw new RangeError('output array is too small');
    for (let i = 0; i < maxAttempts; i++) {
      const s1 = Atomics.load(this.header, HeaderIndex.Sequence);
      if (s1 & 1) continue;
      const bodyCount = Atomics.load(this.header, HeaderIndex.BodyCount);
      const stepCount = Atomics.load(this.header, HeaderIndex.StepCount);
      out.set(this.floats.subarray(0, bodyCount * FLOATS_PER_BODY));
      const s2 = Atomics.load(this.header, HeaderIndex.Sequence);
      if (s1 === s2) return { bodyCount, stepCount };
    }
    return null;
  }
}
