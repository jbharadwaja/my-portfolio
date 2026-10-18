// Custom cursor (spec §6.3). For now only the drag threshold the rail shares with the cursor (Ruling R4); the
// cursor itself is Task 16's. Pure and Node-testable.

/** A press becomes a drag after this many CSS px of movement. */
export const DRAG_THRESHOLD = 6;

/** Whether a press that has moved `dist` CSS px is a drag. */
export function isDrag(dist) {
  return dist > DRAG_THRESHOLD;
}
