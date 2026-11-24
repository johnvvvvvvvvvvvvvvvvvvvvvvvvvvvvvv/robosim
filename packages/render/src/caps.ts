export interface RenderCaps {
  webgl2: boolean;
  webgpu: boolean;
  offscreenCanvas: boolean;
}

/** فحص قدرات الرسم. التنفيذ الحالي WebGL2؛ WebGPU مخصص لترقية لاحقة. */
export function detectRenderCaps(): RenderCaps {
  const probe = document.createElement('canvas');
  return {
    webgl2: probe.getContext('webgl2') !== null,
    webgpu: 'gpu' in navigator,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
}
