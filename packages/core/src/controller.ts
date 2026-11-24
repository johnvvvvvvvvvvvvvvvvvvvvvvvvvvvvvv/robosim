import type { SensorReading } from './sensor';

/** مدخلات المتحكم في كل دورة تحكم. */
export interface ControllerInput {
  time: number;
  readings: Readonly<Record<string, SensorReading>>;
}

/** مخرجات المتحكم: أهداف المحركات بحسب المعرّف. */
export type ControllerOutput = Readonly<Record<string, number>>;

/**
 * عقد المتحكم. ينفَّذ كود المستخدم داخل Worker معزول ويُغلَّف بهذه الواجهة.
 * يجب أن تكون الدالة سريعة، وتُفرض عليها مهلة تنفيذ من النظام.
 */
export interface Controller {
  init?(): void | Promise<void>;
  update(input: ControllerInput): ControllerOutput;
  dispose?(): void;
}
