import { describe, expect, it } from 'vitest';
import { FLOATS_PER_BODY, HeaderIndex, createStateBuffer } from '@robosim/core';
import { SharedStateReader, SharedStateWriter } from './shared-state';

function setup(max = 8) {
  const buf = createStateBuffer(max);
  return {
    buf,
    writer: new SharedStateWriter(buf, max),
    reader: new SharedStateReader(buf, max),
  };
}

describe('shared state seqlock', () => {
  it('round-trips body data', () => {
    const { writer, reader } = setup();
    writer.begin();
    writer.writeBody(0, 1, 2, 3, 0, 0, 0, 1);
    writer.writeBody(1, 4, 5, 6, 0, 0, 0.5, 0.5);
    writer.end(2, 42);

    const out = reader.createOutput();
    const frame = reader.read(out);
    expect(frame).toEqual({ bodyCount: 2, stepCount: 42 });
    expect(Array.from(out.subarray(0, FLOATS_PER_BODY))).toEqual([1, 2, 3, 0, 0, 0, 1]);
    expect(out[FLOATS_PER_BODY + 2]).toBe(6);
  });

  it('returns null while a write is in progress', () => {
    const { writer, reader } = setup();
    writer.begin(); // لم ينتهِ
    expect(reader.read(reader.createOutput())).toBeNull();
    writer.end(0, 1);
    expect(reader.read(reader.createOutput())).not.toBeNull();
  });

  it('keeps sequence even after each complete write', () => {
    const { buf, writer } = setup();
    const header = new Int32Array(buf, 0, 4);
    for (let i = 0; i < 5; i++) {
      writer.begin();
      writer.end(0, i);
      expect((header[HeaderIndex.Sequence] ?? 1) % 2).toBe(0);
    }
  });

  it('marks cleared slots as NaN', () => {
    const { writer, reader } = setup();
    writer.begin();
    writer.writeBody(0, 1, 1, 1, 0, 0, 0, 1);
    writer.clearBody(0);
    writer.end(1, 1);
    const out = reader.createOutput();
    reader.read(out);
    expect(Number.isNaN(out[0])).toBe(true);
  });

  it('rejects an output array that is too small', () => {
    const { reader } = setup();
    expect(() => reader.read(new Float32Array(3))).toThrow(RangeError);
  });
});
