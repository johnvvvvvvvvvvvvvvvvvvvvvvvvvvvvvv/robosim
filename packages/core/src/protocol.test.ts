import { describe, expect, it } from 'vitest';
import { FLOATS_PER_BODY, HEADER_BYTES, computeStateLayout, createStateBuffer } from './protocol';

describe('state layout', () => {
  it('computes sizes correctly', () => {
    const l = computeStateLayout(10);
    expect(l.bodiesByteOffset).toBe(HEADER_BYTES);
    expect(l.totalBytes).toBe(HEADER_BYTES + 10 * FLOATS_PER_BODY * 4);
  });

  it('keeps float section 4-byte aligned', () => {
    expect(computeStateLayout(3).bodiesByteOffset % 4).toBe(0);
  });

  it('rejects invalid sizes', () => {
    expect(() => computeStateLayout(0)).toThrow(RangeError);
    expect(() => computeStateLayout(1.5)).toThrow(RangeError);
  });

  it('allocates a SharedArrayBuffer of the right size', () => {
    const buf = createStateBuffer(8);
    expect(buf.byteLength).toBe(computeStateLayout(8).totalBytes);
  });
});
