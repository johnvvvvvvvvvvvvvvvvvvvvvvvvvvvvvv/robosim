/** أنواع رياضية أساسية مشتركة بين كل الحزم. الوحدات: متر، راديان، ثانية. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** رباعي (x, y, z, w) بصيغة وحدة. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Transform {
  position: Vec3;
  rotation: Quat;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const QUAT_IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
