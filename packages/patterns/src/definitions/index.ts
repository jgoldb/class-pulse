import type { PatternDefinition } from '../engine/window';
import { strengthUnderutilization } from './strength-underutilization';
import { contextPerformanceDivergence } from './context-performance-divergence';
import { taskLengthSensitivity } from './task-length-sensitivity';
import { timeOfDayClustering } from './time-of-day-clustering';
import { unstructuredTimeClustering } from './unstructured-time-clustering';
import { attendancePerformanceCoupling } from './attendance-performance-coupling';
import { strategyEffectivenessSignal } from './strategy-effectiveness-signal';
import { nonResponseTrajectory } from './non-response-trajectory';

/**
 * The seed catalog (docs/02). Per the roadmap, `strength-underutilization` and
 * `context-performance-divergence` start `active`; the rest start `piloting` — detected and
 * measured, shown to no one — until they clear the confirmation-rate floor and a proxy review.
 * Status can be overridden from the admin surface (stored in the API's definition_status table).
 */
export const PATTERN_CATALOG: PatternDefinition[] = [
  strengthUnderutilization,
  contextPerformanceDivergence,
  taskLengthSensitivity,
  timeOfDayClustering,
  unstructuredTimeClustering,
  attendancePerformanceCoupling,
  strategyEffectivenessSignal,
  nonResponseTrajectory,
];

export function definitionById(id: string): PatternDefinition | undefined {
  return PATTERN_CATALOG.find((d) => d.id === id);
}

export {
  strengthUnderutilization,
  contextPerformanceDivergence,
  taskLengthSensitivity,
  timeOfDayClustering,
  unstructuredTimeClustering,
  attendancePerformanceCoupling,
  strategyEffectivenessSignal,
  nonResponseTrajectory,
};
