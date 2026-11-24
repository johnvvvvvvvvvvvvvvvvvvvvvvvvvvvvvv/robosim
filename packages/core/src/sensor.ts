/** عقد الحساسات. لكل حساس تردده الخاص ولا يعمل كل خطوة فيزياء. */
export interface SensorSpec {
  id: string;
  kind: string;
  /** تردد القراءة بالهرتز، يجب أن يقسم تردد الفيزياء قدر الإمكان. */
  rateHz: number;
  /** انحراف معياري للضجيج (0 = بدون ضجيج). */
  noiseStdDev: number;
}

export interface SensorReading<T = unknown> {
  sensorId: string;
  /** الزمن المحاكى للقراءة بالثواني. */
  time: number;
  value: T;
}

export interface Sensor<T = unknown> {
  readonly spec: Readonly<SensorSpec>;
  /** تُستدعى كل خطوة فيزياء؛ ترجع قراءة فقط عندما يحين موعدها. */
  update(time: number): SensorReading<T> | null;
}
