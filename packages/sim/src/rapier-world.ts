import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type {
  Body,
  BodyDescriptor,
  BodyId,
  Ray,
  RayHit,
  Transform,
  World,
  WorldConfig,
} from '@robosim/core';
import type { SharedStateWriter } from './shared-state';

/** المستوى اللانهائي يُمثَّل بصندوق ضخم وسطحه العلوي عند موضع الجسم. */
const PLANE_HALF_EXTENT = 1000;
const PLANE_HALF_THICKNESS = 1;

interface Entry {
  id: BodyId;
  descriptor: BodyDescriptor;
  rb: RAPIER.RigidBody;
  slot: number;
  /** هل يجب كتابة موضعه في الذاكرة المشتركة في الكتابة القادمة؟ */
  needsWrite: boolean;
}

interface SnapshotMeta {
  version: 1;
  nextId: number;
  stepCount: number;
  highWater: number;
  freeSlots: number[];
  bodies: Array<{ id: number; handle: number; slot: number; descriptor: BodyDescriptor }>;
}

/** تنفيذ World فوق Rapier (نسخة deterministic). يجب إنشاؤه عبر RapierWorld.create. */
export class RapierWorld implements World {
  readonly config: Readonly<WorldConfig>;

  private world: RAPIER.World;
  private readonly entries = new Map<number, Entry>();
  private readonly handleToId = new Map<number, number>();
  private freeSlots: number[] = [];
  private highWater = 0;
  private nextId = 1;
  private stepCount = 0;

  private constructor(config: WorldConfig, world: RAPIER.World) {
    this.config = config;
    this.world = world;
    this.world.timestep = 1 / config.physicsHz;
  }

  static async create(config: WorldConfig): Promise<RapierWorld> {
    await RAPIER.init();
    return new RapierWorld(config, new RAPIER.World(config.gravity));
  }

  get time(): number {
    return this.stepCount / this.config.physicsHz;
  }

  get steps(): number {
    return this.stepCount;
  }

  get bodyCount(): number {
    return this.entries.size;
  }

  addBody(descriptor: BodyDescriptor): Body {
    if (this.entries.size >= this.config.maxBodies) {
      throw new RangeError(`maxBodies (${this.config.maxBodies}) reached`);
    }
    const { type, shape, transform } = descriptor;

    const rbDesc =
      type === 'dynamic'
        ? RAPIER.RigidBodyDesc.dynamic()
        : type === 'kinematic'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.fixed();
    rbDesc
      .setTranslation(transform.position.x, transform.position.y, transform.position.z)
      .setRotation(transform.rotation);

    let colDesc: RAPIER.ColliderDesc;
    switch (shape.kind) {
      case 'box':
        colDesc = RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
        break;
      case 'sphere':
        colDesc = RAPIER.ColliderDesc.ball(shape.radius);
        break;
      case 'cylinder':
        colDesc = RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        break;
      case 'plane':
        if (type !== 'static') throw new Error('plane must be static');
        colDesc = RAPIER.ColliderDesc.cuboid(PLANE_HALF_EXTENT, PLANE_HALF_THICKNESS, PLANE_HALF_EXTENT)
          .setTranslation(0, -PLANE_HALF_THICKNESS, 0);
        break;
    }
    if (descriptor.friction !== undefined) colDesc.setFriction(descriptor.friction);
    if (descriptor.restitution !== undefined) colDesc.setRestitution(descriptor.restitution);
    if (descriptor.mass !== undefined && type === 'dynamic') colDesc.setMass(descriptor.mass);

    const rb = this.world.createRigidBody(rbDesc);
    this.world.createCollider(colDesc, rb);

    const id = this.nextId++ as BodyId;
    const slot = this.allocateSlot();
    this.entries.set(id, { id, descriptor, rb, slot, needsWrite: true });
    this.handleToId.set(rb.handle, id);
    return { id, descriptor };
  }

  removeBody(id: BodyId): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.world.removeRigidBody(entry.rb);
    this.handleToId.delete(entry.rb.handle);
    this.entries.delete(id);
    this.releaseSlot(entry.slot);
  }

  /** رقم الخانة في الذاكرة المشتركة (يستخدمه الرسم لربط الجسم بمكانه). */
  slotOf(id: BodyId): number | undefined {
    return this.entries.get(id)?.slot;
  }

  getBodyTransform(id: BodyId): Transform | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    const t = e.rb.translation();
    const r = e.rb.rotation();
    return { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
  }

  step(): void {
    this.world.step();
    this.stepCount++;
  }

  /** يكتب مواضع الأجسام المتغيرة فقط في الذاكرة المشتركة. */
  writeState(writer: SharedStateWriter): void {
    writer.begin();
    for (const e of this.entries.values()) {
      const isStatic = e.descriptor.type === 'static';
      const sleeping = !isStatic && e.rb.isSleeping();
      // الثابت يُكتب مرة واحدة؛ النائم يُكتب مرة أخيرة بعد نومه ثم يتوقف
      if (!e.needsWrite && (isStatic || sleeping)) continue;
      const t = e.rb.translation();
      const r = e.rb.rotation();
      writer.writeBody(e.slot, t.x, t.y, t.z, r.x, r.y, r.z, r.w);
      e.needsWrite = !isStatic && !sleeping;
    }
    for (const slot of this.freeSlots) writer.clearBody(slot);
    writer.end(this.highWater, this.stepCount);
  }

  raycast(ray: Ray): RayHit | null {
    const { x, y, z } = ray.direction;
    const len = Math.hypot(x, y, z);
    if (len === 0) return null;
    const dir = { x: x / len, y: y / len, z: z / len };
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(ray.origin, dir), ray.maxDistance, true);
    if (!hit) return null;
    const handle = hit.collider.parent()?.handle;
    const id = handle === undefined ? undefined : this.handleToId.get(handle);
    if (id === undefined) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      bodyId: id as BodyId,
      point: { x: ray.origin.x + dir.x * d, y: ray.origin.y + dir.y * d, z: ray.origin.z + dir.z * d },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
    };
  }

  /** الصيغة: [uint32 طول JSON][JSON meta][لقطة Rapier]. */
  snapshot(): Uint8Array {
    const meta: SnapshotMeta = {
      version: 1,
      nextId: this.nextId,
      stepCount: this.stepCount,
      highWater: this.highWater,
      freeSlots: [...this.freeSlots],
      bodies: [...this.entries.values()].map((e) => ({
        id: e.id,
        handle: e.rb.handle,
        slot: e.slot,
        descriptor: e.descriptor,
      })),
    };
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const rapierBytes = this.world.takeSnapshot();
    const out = new Uint8Array(4 + metaBytes.length + rapierBytes.length);
    new DataView(out.buffer).setUint32(0, metaBytes.length, true);
    out.set(metaBytes, 4);
    out.set(rapierBytes, 4 + metaBytes.length);
    return out;
  }

  restore(snapshot: Uint8Array): void {
    const metaLen = new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength).getUint32(0, true);
    const meta = JSON.parse(
      new TextDecoder().decode(snapshot.subarray(4, 4 + metaLen)),
    ) as SnapshotMeta;
    if (meta.version !== 1) throw new Error(`unsupported snapshot version ${meta.version}`);

    const restored = RAPIER.World.restoreSnapshot(snapshot.slice(4 + metaLen));
    restored.timestep = 1 / this.config.physicsHz;
    this.world.free();
    this.world = restored;

    this.entries.clear();
    this.handleToId.clear();
    for (const b of meta.bodies) {
      const rb = restored.getRigidBody(b.handle);
      this.entries.set(b.id, {
        id: b.id as BodyId,
        descriptor: b.descriptor,
        rb,
        slot: b.slot,
        needsWrite: true,
      });
      this.handleToId.set(b.handle, b.id);
    }
    this.nextId = meta.nextId;
    this.stepCount = meta.stepCount;
    this.highWater = meta.highWater;
    this.freeSlots = [...meta.freeSlots];
  }

  dispose(): void {
    this.world.free();
    this.entries.clear();
    this.handleToId.clear();
  }

  /** أصغر خانة فارغة أولاً (ترتيب حتمي). */
  private allocateSlot(): number {
    const reused = this.freeSlots.shift();
    if (reused !== undefined) return reused;
    return this.highWater++;
  }

  private releaseSlot(slot: number): void {
    this.freeSlots.push(slot);
    this.freeSlots.sort((a, b) => a - b);
  }
}
