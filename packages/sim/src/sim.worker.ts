/// <reference lib="webworker" />
import type { BodyId, MainToSim, SimToMain } from '@robosim/core';
import { FixedStepClock } from './clock';
import { RapierWorld } from './rapier-world';
import { SharedStateWriter } from './shared-state';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: SimToMain): void => ctx.postMessage(msg);

let world: RapierWorld | null = null;
let writer: SharedStateWriter | null = null;
let clock: FixedStepClock | null = null;
let config: Extract<MainToSim, { type: 'init' }>['config'] | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastNow = 0;
let statSteps = 0;
let statMs = 0;
let statStart = 0;

function tick(): void {
  const now = performance.now();
  const dt = (now - lastNow) / 1000;
  lastNow = now;

  if (world && writer && clock) {
    const n = clock.advance(dt);
    if (n > 0) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) world.step();
      world.writeState(writer);
      statMs += performance.now() - t0;
      statSteps += n;
    }
    const elapsed = now - statStart;
    if (elapsed >= 500) {
      post({
        type: 'stats',
        stepMs: statSteps > 0 ? statMs / statSteps : 0,
        stepsPerSecond: (statSteps * 1000) / elapsed,
        time: world.time,
      });
      statSteps = 0;
      statMs = 0;
      statStart = now;
    }
  }
  timer = setTimeout(tick, 1);
}

function startLoop(): void {
  if (timer !== null) return;
  lastNow = performance.now();
  statStart = lastNow;
  timer = setTimeout(tick, 1);
}

async function handle(msg: MainToSim): Promise<void> {
  switch (msg.type) {
    case 'init': {
      config = msg.config;
      world = await RapierWorld.create(msg.config);
      writer = new SharedStateWriter(msg.stateBuffer, msg.config.maxBodies);
      writer.clearAll();
      clock = new FixedStepClock(1 / msg.config.physicsHz);
      post({ type: 'ready' });
      startLoop();
      return;
    }
    case 'addBody': {
      if (!world || !writer) throw new Error('not initialized');
      const body = world.addBody(msg.descriptor);
      world.writeState(writer);
      post({
        type: 'bodyAdded',
        requestId: msg.requestId,
        id: body.id,
        slot: world.slotOf(body.id) ?? -1,
      });
      return;
    }
    case 'removeBody': {
      if (!world || !writer) return;
      world.removeBody(msg.id as BodyId);
      world.writeState(writer);
      return;
    }
    case 'setSpeed':
      clock?.setSpeed(msg.multiplier);
      return;
    case 'pause':
      clock?.pause();
      return;
    case 'resume':
      clock?.resume();
      return;
    case 'stepOnce':
      clock?.stepOnce();
      return;
    case 'reset': {
      if (!config || !writer) return;
      world?.dispose();
      world = await RapierWorld.create(config);
      writer.begin();
      writer.clearAll();
      writer.end(0, 0);
      clock?.reset();
      return;
    }
    case 'dispose': {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      world?.dispose();
      world = null;
      ctx.close();
      return;
    }
  }
}

// معالجة الرسائل بالتسلسل (init غير متزامن، وقد تصل رسائل قبل اكتماله)
let queue: Promise<void> = Promise.resolve();
ctx.onmessage = (e: MessageEvent<MainToSim>) => {
  queue = queue
    .then(() => handle(e.data))
    .catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
};
