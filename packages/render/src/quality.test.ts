import { describe, expect, it } from 'vitest';
import { AdaptiveQuality } from './quality';

function feed(q: AdaptiveQuality, frameMs: number, seconds: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds * 1000; t += frameMs) {
    const c = q.sample(frameMs);
    if (c !== null) changes.push(c);
  }
  return changes;
}

describe('AdaptiveQuality', () => {
  it('lowers quality when fps is low', () => {
    const q = new AdaptiveQuality(0);
    expect(feed(q, 40, 10).length).toBeGreaterThan(0);
    expect(q.level).toBeGreaterThan(0);
  });

  it('keeps quality when fps is good', () => {
    const q = new AdaptiveQuality(0);
    feed(q, 16.7, 10);
    expect(q.level).toBe(0);
  });

  it('does not change while locked', () => {
    const q = new AdaptiveQuality(0);
    q.setLocked(true);
    feed(q, 40, 10);
    expect(q.level).toBe(0);
  });

  it('raises quality again after sustained good fps', () => {
    const q = new AdaptiveQuality(3);
    feed(q, 16.7, 20);
    expect(q.level).toBeLessThan(3);
  });
});
