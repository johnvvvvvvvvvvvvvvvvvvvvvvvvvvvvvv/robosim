import type { BodyDescriptor, WorldConfig } from './world';

/* ------------------------------------------------------------------ *
 * الرسائل بين الخيط الرئيسي (Main) وworker المحاكاة (Sim).
 * الحالة المتكررة (مواضع الأجسام) تنتقل عبر SharedArrayBuffer،
 * أما الرسائل أدناه فهي للتحكم والأحداث النادرة فقط.
 * ------------------------------------------------------------------ */

export type MainToSim =
  | { type: 'init'; config: WorldConfig; stateBuffer: SharedArrayBuffer }
  | { type: 'addBody'; requestId: number; descriptor: BodyDescriptor }
  | { type: 'removeBody'; id: number }
  | { type: 'setSpeed'; multiplier: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stepOnce' }
  | { type: 'reset' }
  | { type: 'dispose' };

export type SimToMain =
  | { type: 'ready' }
  | { type: 'bodyAdded'; requestId: number; id: number; slot: number }
  | { type: 'stats'; stepMs: number; stepsPerSecond: number; time: number }
  | { type: 'error'; message: string };

/* ------------------------------------------------------------------ *
 * تخطيط الذاكرة المشتركة (Seqlock):
 *   [Int32 header × HEADER_INTS][Float32 × bodyCount × FLOATS_PER_BODY]
 *   header[0] = sequence (فردي أثناء الكتابة، زوجي عند الاكتمال)
 *   header[1] = عدد الأجسام الفعالة
 *   header[2] = عدد الخطوات المنفذة (frame counter)
 * القارئ يقرأ seq، ينسخ، يقرأ seq ثانية، ويعيد المحاولة إن اختلفت أو كانت فردية.
 * ------------------------------------------------------------------ */

export const HEADER_INTS = 4;
export const FLOATS_PER_BODY = 7; // px py pz qx qy qz qw
export const HEADER_BYTES = HEADER_INTS * Int32Array.BYTES_PER_ELEMENT;

export const HeaderIndex = {
  Sequence: 0,
  BodyCount: 1,
  StepCount: 2,
} as const;

export interface StateLayout {
  maxBodies: number;
  headerBytes: number;
  bodiesByteOffset: number;
  totalBytes: number;
}

export function computeStateLayout(maxBodies: number): StateLayout {
  if (!Number.isInteger(maxBodies) || maxBodies <= 0) {
    throw new RangeError(`maxBodies must be a positive integer, got ${maxBodies}`);
  }
  const bodiesByteOffset = HEADER_BYTES;
  const totalBytes =
    bodiesByteOffset + maxBodies * FLOATS_PER_BODY * Float32Array.BYTES_PER_ELEMENT;
  return { maxBodies, headerBytes: HEADER_BYTES, bodiesByteOffset, totalBytes };
}

export function createStateBuffer(maxBodies: number): SharedArrayBuffer {
  return new SharedArrayBuffer(computeStateLayout(maxBodies).totalBytes);
}
