import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './clock';

const DT = 1 / 240;

describe('FixedStepClock', () => {
  it('converts real time to whole steps', () => {
    const c = new FixedStepClock(DT);
    expect(c.advance(1 / 60)).toBe(4);
  });

  it('accumulates fractions across ticks', () => {
    const c = new FixedStepClock(DT);
    let total = 0;
    for (let i = 0; i < 5; i++) total += c.advance(0.001);
    expect(total).toBe(1);
  });

  it('does nothing while paused, but stepOnce still works', () => {
    const c = new FixedStepClock(DT);
    c.pause();
    expect(c.advance(1)).toBe(0);
    c.stepOnce();
    c.stepOnce();
    expect(c.advance(1)).toBe(2);
    expect(c.advance(1)).toBe(0);
  });

  it('scales with speed', () => {
    const c = new FixedStepClock(DT);
    c.setSpeed(2);
    expect(c.advance(1 / 60)).toBe(8);
  });

  it('caps steps per tick and drops the excess', () => {
    const c = new FixedStepClock(DT, 20);
    expect(c.advance(10)).toBe(20);
    expect(c.advance(0)).toBe(0);
  });

  it('rejects invalid speed', () => {
    const c = new FixedStepClock(DT);
    expect(() => c.setSpeed(0)).toThrow(RangeError);
    expect(() => c.setSpeed(1000)).toThrow(RangeError);
  });
});
