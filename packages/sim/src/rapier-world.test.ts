import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONFIG,
  QUAT_IDENTITY,
  type BodyId,
  type WorldConfig,
} from '@robosim/core';
import { RapierWorld } from './rapier-world';
import { mulberry32 } from './rng';

const cfg: WorldConfig = { ...DEFAULT_WORLD_CONFIG, maxBodies: 512 };

async function makeScene(boxes: number, seed = 1) {
  const world = await RapierWorld.create(cfg);
  const ground = world.addBody({
    type: 'static',
    shape: { kind: 'plane' },
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { ...QUAT_IDENTITY } },
  });
  const rand = mulberry32(seed);
  const ids: BodyId[] = [];
  for (let i = 0; i < boxes; i++) {
    const b = world.addBody({
      type: 'dynamic',
      shape: { kind: 'box', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } },
      transform: {
        position: { x: (rand() - 0.5) * 6, y: 1 + i * 0.6, z: (rand() - 0.5) * 6 },
        rotation: { ...QUAT_IDENTITY },
      },
      mass: 1,
      friction: 0.6,
    });
    ids.push(b.id);
  }
  return { world, ground: ground.id, ids };
}

function positions(world: RapierWorld, ids: BodyId[]): number[] {
  return ids.flatMap((id) => {
    const t = world.getBodyTransform(id);
    return t ? [t.position.x, t.position.y, t.position.z] : [];
  });
}

function run(world: RapierWorld, steps: number): void {
  for (let i = 0; i < steps; i++) world.step();
}

describe('RapierWorld', () => {
  it('a box falls and rests on the ground', async () => {
    const { world, ids } = await makeScene(1);
    run(world, 600); // 2.5 ثانية
    const t = world.getBodyTransform(ids[0] as BodyId);
    expect(t?.position.y).toBeCloseTo(0.25, 1);
    world.dispose();
  });

  it('is deterministic: same seed gives identical results', async () => {
    const a = await makeScene(30, 5);
    const b = await makeScene(30, 5);
    run(a.world, 600);
    run(b.world, 600);
    expect(positions(a.world, a.ids)).toEqual(positions(b.world, b.ids));
  });

  it('snapshot/restore reproduces the same future', async () => {
    const { world, ids } = await makeScene(30, 9);
    run(world, 300);
    const snap = world.snapshot();
    run(world, 300);
    const expected = positions(world, ids);

    world.restore(snap);
    expect(world.steps).toBe(300);
    run(world, 300);
    expect(positions(world, ids)).toEqual(expected);
  });

  it('stays stable with 100 stacked bodies (20s simulated)', async () => {
    const { world, ids } = await makeScene(100, 3);
    run(world, 240 * 20);
    for (const v of positions(world, ids)) expect(Number.isFinite(v)).toBe(true);
    const ys = positions(world, ids).filter((_, i) => i % 3 === 1);
    for (const y of ys) expect(y).toBeGreaterThan(0);
  });

  it('raycast hits the ground from above', async () => {
    const { world, ground } = await makeScene(0);
    const hit = world.raycast({
      origin: { x: 0, y: 10, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 100,
    });
    expect(hit?.bodyId).toBe(ground);
    expect(hit?.distance).toBeCloseTo(10, 3);
    expect(hit?.normal.y).toBeCloseTo(1, 3);
  });

  it('reuses the smallest freed slot', async () => {
    const { world, ids } = await makeScene(3);
    const second = ids[1] as BodyId;
    const slot = world.slotOf(second);
    world.removeBody(second);
    const again = world.addBody({
      type: 'dynamic',
      shape: { kind: 'sphere', radius: 0.2 },
      transform: { position: { x: 0, y: 5, z: 0 }, rotation: { ...QUAT_IDENTITY } },
    });
    expect(world.slotOf(again.id)).toBe(slot);
  });

  it('enforces maxBodies', async () => {
    const world = await RapierWorld.create({ ...cfg, maxBodies: 2 });
    const d = {
      type: 'dynamic' as const,
      shape: { kind: 'sphere' as const, radius: 0.1 },
      transform: { position: { x: 0, y: 1, z: 0 }, rotation: { ...QUAT_IDENTITY } },
    };
    world.addBody(d);
    world.addBody(d);
    expect(() => world.addBody(d)).toThrow(RangeError);
  });
});
