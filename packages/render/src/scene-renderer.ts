import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FLOATS_PER_BODY, type BodyDescriptor, type Shape } from '@robosim/core';
import { AdaptiveQuality, QUALITY_LEVELS } from './quality';

/** أي مصدر يعطي لقطات الحالة (SharedStateReader يطابق هذه الواجهة). */
export interface BodyStateSource {
  createOutput(): Float32Array;
  read(out: Float32Array): { bodyCount: number; stepCount: number } | null;
}

export interface RenderOptions {
  maxBodies: number;
  shadows?: boolean;
  antialias?: boolean;
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  qualityLevel: number;
  pixelRatio: number;
}

export type CameraMode = 'free' | 'follow';
type Kind = 'box' | 'sphere' | 'cylinder';

interface SlotInfo {
  kind: Kind;
  index: number;
  scale: THREE.Vector3;
  isStatic: boolean;
  dirty: boolean;
  hidden: boolean;
}

interface KindPool {
  mesh: THREE.InstancedMesh;
  free: number[];
  next: number;
  touched: boolean;
}

const val = (a: Float32Array, i: number): number => a[i] ?? Number.NaN;
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * يرسم الأجسام من الذاكرة المشتركة باستخدام InstancedMesh (استدعاء رسم واحد لكل نوع شكل)،
 * مع استيفاء بين آخر لقطتين لسلاسة العرض، وضبط جودة تلقائي.
 */
export class SceneRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  onStats: ((s: RenderStats) => void) | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly light: THREE.DirectionalLight;
  private readonly material = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 });
  private readonly pools: Record<Kind, KindPool>;
  private readonly slots: Array<SlotInfo | undefined> = [];
  private readonly grounds = new Map<number, THREE.Object3D[]>();
  private slotsHigh = 0;

  // لقطات الحالة والاستيفاء
  private readonly tmp: Float32Array;
  private readonly prev: Float32Array;
  private readonly curr: Float32Array;
  private currStep = -1;
  private prevTime = 0;
  private currTime = 0;
  private intervalMs = 16;

  private readonly quality = new AdaptiveQuality(0);
  private autoQuality = true;
  private userShadows: boolean;
  private shadowSize = -1;

  private cameraMode: CameraMode = 'free';
  private followSlotId: number | null = null;
  private readonly followPos = new THREE.Vector3();
  private followValid = false;

  private raf = 0;
  private lastT = 0;
  private statsAt = 0;
  private readonly resizeObserver: ResizeObserver;

  // كائنات مؤقتة لتجنب التخصيص في كل إطار
  private readonly m4 = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly qr = new THREE.Quaternion();
  private readonly tmpColor = new THREE.Color();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: BodyStateSource,
    opts: RenderOptions,
  ) {
    this.userShadows = opts.shadows ?? true;
    this.tmp = source.createOutput();
    this.prev = source.createOutput();
    this.curr = source.createOutput();
    this.prev.fill(Number.NaN);
    this.curr.fill(Number.NaN);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias ?? false,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x0e1319);
    this.scene.fog = new THREE.Fog(0x0e1319, 60, 200);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242c, 0.8));

    this.light = new THREE.DirectionalLight(0xffffff, 2.2);
    this.light.position.set(8, 18, 6);
    const sc = this.light.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 18;
    sc.bottom = -18;
    sc.near = 1;
    sc.far = 60;
    this.light.shadow.bias = -0.0005;
    this.scene.add(this.light, this.light.target);

    this.camera.position.set(12, 9, 14);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 2, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.update();

    const makePool = (geo: THREE.BufferGeometry): KindPool => {
      const mesh = new THREE.InstancedMesh(geo, this.material, opts.maxBodies);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return { mesh, free: [], next: 0, touched: false };
    };
    this.pools = {
      box: makePool(new THREE.BoxGeometry(1, 1, 1)),
      sphere: makePool(new THREE.SphereGeometry(0.5, 24, 16)),
      cylinder: makePool(new THREE.CylinderGeometry(0.5, 0.5, 1, 24)),
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.applyLevel(0);
  }

  /* ---------------- الأجسام ---------------- */

  addBody(slot: number, d: BodyDescriptor): void {
    if (d.shape.kind === 'plane') {
      this.addGround(slot, d);
      return;
    }
    const kind = d.shape.kind;
    const pool = this.pools[kind];
    const index = pool.free.pop() ?? pool.next++;
    pool.mesh.count = Math.max(pool.mesh.count, index + 1);

    const hue = (slot * 0.618033988749895) % 1;
    const isStatic = d.type === 'static';
    this.tmpColor.setHSL(hue, isStatic ? 0.1 : 0.55, isStatic ? 0.35 : 0.58);
    pool.mesh.setColorAt(index, this.tmpColor);
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;

    this.slots[slot] = {
      kind,
      index,
      scale: this.scaleOf(d.shape),
      isStatic,
      dirty: true,
      hidden: false,
    };
    this.slotsHigh = Math.max(this.slotsHigh, slot + 1);
  }

  removeBody(slot: number): void {
    const ground = this.grounds.get(slot);
    if (ground) {
      for (const o of ground) {
        this.scene.remove(o);
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      }
      this.grounds.delete(slot);
      return;
    }
    const info = this.slots[slot];
    if (!info) return;
    const pool = this.pools[info.kind];
    pool.mesh.setMatrixAt(info.index, ZERO_MATRIX);
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.free.push(info.index);
    this.slots[slot] = undefined;
  }

  clear(): void {
    for (const slot of [...this.grounds.keys()]) this.removeBody(slot);
    for (let i = 0; i < this.slotsHigh; i++) this.removeBody(i);
    for (const pool of Object.values(this.pools)) {
      pool.free = [];
      pool.next = 0;
      pool.mesh.count = 0;
    }
    this.slotsHigh = 0;
    this.prev.fill(Number.NaN);
    this.curr.fill(Number.NaN);
    this.currStep = -1;
    this.followSlotId = null;
    this.followValid = false;
  }

  private addGround(slot: number, d: BodyDescriptor): void {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x232b36, roughness: 0.95 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    const grid = new THREE.GridHelper(400, 200, 0x3a4658, 0x2a3340);
    grid.position.y = 0.002;
    const p = d.transform.position;
    const r = d.transform.rotation;
    for (const o of [plane, grid]) {
      o.position.add(new THREE.Vector3(p.x, p.y, p.z));
      o.quaternion.premultiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      this.scene.add(o);
    }
    this.grounds.set(slot, [plane, grid]);
  }

  private scaleOf(shape: Shape): THREE.Vector3 {
    switch (shape.kind) {
      case 'box':
        return new THREE.Vector3(shape.halfExtents.x * 2, shape.halfExtents.y * 2, shape.halfExtents.z * 2);
      case 'sphere':
        return new THREE.Vector3(shape.radius * 2, shape.radius * 2, shape.radius * 2);
      case 'cylinder':
        return new THREE.Vector3(shape.radius * 2, shape.halfHeight * 2, shape.radius * 2);
      case 'plane':
        return new THREE.Vector3(1, 1, 1);
    }
  }

  /* ---------------- الكاميرا والجودة ---------------- */

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  followSlot(slot: number | null): void {
    this.followSlotId = slot;
    this.followValid = false;
  }

  setShadows(on: boolean): void {
    this.userShadows = on;
    this.applyLevel(this.quality.level);
  }

  /** 'auto' للضبط التلقائي، أو رقم مستوى ثابت (0 الأعلى جودة). */
  setQuality(mode: 'auto' | number): void {
    if (mode === 'auto') {
      this.autoQuality = true;
      this.quality.setLocked(false);
    } else {
      this.autoQuality = false;
      this.quality.setLocked(true);
      this.quality.setLevel(mode);
      this.applyLevel(this.quality.level);
    }
  }

  get qualityLevelCount(): number {
    return QUALITY_LEVELS.length;
  }

  private applyLevel(level: number): void {
    const q = QUALITY_LEVELS[level] ?? QUALITY_LEVELS[0];
    if (!q) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioCap));
    this.resize();

    const enable = this.userShadows && q.shadowMapSize > 0;
    if (enable && q.shadowMapSize !== this.shadowSize) {
      this.light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.shadowSize = q.shadowMapSize;
    }
    if (this.light.castShadow !== enable) {
      this.light.castShadow = enable;
      this.material.needsUpdate = true;
    }
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- الحلقة ---------------- */

  start(): void {
    if (this.raf !== 0) return;
    this.lastT = performance.now();
    this.statsAt = this.lastT;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly frame = (t: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = t - this.lastT;
    this.lastT = t;

    this.pullState(t);
    this.updateInstances(t);
    this.updateCamera();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (this.autoQuality) {
      const changed = this.quality.sample(dt);
      if (changed !== null) this.applyLevel(changed);
    } else {
      this.quality.sample(dt); // لحساب fps فقط
    }

    if (this.onStats && t - this.statsAt >= 500) {
      this.statsAt = t;
      this.onStats({
        fps: this.quality.fps,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        qualityLevel: this.quality.level,
        pixelRatio: this.renderer.getPixelRatio(),
      });
    }
  };

  /** يقرأ آخر لقطة؛ عند تغير رقم الخطوة تصبح السابقة "prev" ويُقاس الفاصل بينهما. */
  private pullState(t: number): void {
    const f = this.source.read(this.tmp);
    if (!f) return;
    if (f.stepCount !== this.currStep) {
      this.prev.set(this.curr);
      if (this.currStep >= 0) {
        const dtMs = Math.min(Math.max(t - this.currTime, 1), 100);
        this.intervalMs += (dtMs - this.intervalMs) * 0.2;
      }
      this.prevTime = this.currTime;
      this.currTime = t;
      this.currStep = f.stepCount;
    }
    this.curr.set(this.tmp);
  }

  private updateInstances(t: number): void {
    const alpha = Math.min(Math.max((t - this.currTime) / this.intervalMs, 0), 1);
    const { prev, curr } = this;

    for (let slot = 0; slot < this.slotsHigh; slot++) {
      const info = this.slots[slot];
      if (!info) continue;
      if (info.isStatic && !info.dirty) continue;
      const pool = this.pools[info.kind];
      const o = slot * FLOATS_PER_BODY;
      const cx = val(curr, o);

      if (!Number.isFinite(cx)) {
        if (!info.hidden) {
          pool.mesh.setMatrixAt(info.index, ZERO_MATRIX);
          pool.touched = true;
          info.hidden = true;
        }
        continue;
      }
      info.hidden = false;

      this.qb.set(val(curr, o + 3), val(curr, o + 4), val(curr, o + 5), val(curr, o + 6));
      if (Number.isFinite(val(prev, o))) {
        this.pos.set(
          val(prev, o) + (cx - val(prev, o)) * alpha,
          val(prev, o + 1) + (val(curr, o + 1) - val(prev, o + 1)) * alpha,
          val(prev, o + 2) + (val(curr, o + 2) - val(prev, o + 2)) * alpha,
        );
        this.qa.set(val(prev, o + 3), val(prev, o + 4), val(prev, o + 5), val(prev, o + 6));
        this.qr.slerpQuaternions(this.qa, this.qb, alpha);
      } else {
        this.pos.set(cx, val(curr, o + 1), val(curr, o + 2));
        this.qr.copy(this.qb);
      }

      this.m4.compose(this.pos, this.qr, info.scale);
      pool.mesh.setMatrixAt(info.index, this.m4);
      pool.touched = true;
      info.dirty = false;

      if (slot === this.followSlotId) {
        this.followPos.copy(this.pos);
        this.followValid = true;
      }
    }

    for (const pool of Object.values(this.pools)) {
      if (pool.touched) {
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.touched = false;
      }
    }
  }

  private updateCamera(): void {
    if (this.cameraMode !== 'follow' || !this.followValid) return;
    const before = this.controls.target.clone();
    this.controls.target.lerp(this.followPos, 0.15);
    this.camera.position.add(this.controls.target.clone().sub(before));
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    for (const pool of Object.values(this.pools)) {
      pool.mesh.geometry.dispose();
      pool.mesh.dispose();
    }
    for (const slot of [...this.grounds.keys()]) this.removeBody(slot);
    this.material.dispose();
    this.renderer.dispose();
  }
}
