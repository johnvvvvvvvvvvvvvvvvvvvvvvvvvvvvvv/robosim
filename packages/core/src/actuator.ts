/** عقد المحركات. وحدة موحدة للعجلات والمفاصل. */
export type ActuatorMode = 'position' | 'velocity' | 'torque';

export interface ActuatorLimits {
  maxTorque: number;
  maxVelocity: number;
}

export interface Actuator {
  readonly id: string;
  readonly mode: ActuatorMode;
  readonly limits: Readonly<ActuatorLimits>;
  /** يضبط الهدف حسب الوضع (راديان، راديان/ثانية، أو نيوتن.متر). */
  setTarget(value: number): void;
  readonly target: number;
}
