/**
 * Selection targets: rows, bars and links, compared and keyed the same way everywhere.
 */
/** What can be selected: a grid row, a bar (one of a task's bars when it has several) or a link. */
export type SelectionTarget =
  | { type: 'row'; taskId: string }
  | { type: 'bar'; taskId: string; bar: string }
  | { type: 'link'; linkId: string };

/** True when two selection targets point at the same row, bar or link. */
export const sameTarget = (a: SelectionTarget, b: SelectionTarget) =>
  a.type === b.type && (a.type === 'link' ? a.linkId === (b as typeof a).linkId : a.taskId === (b as { taskId: string }).taskId);
/** A string key for a selection target, used in sets and as React keys. */
export const targetKey = (t: SelectionTarget) => (t.type === 'link' ? `link:${t.linkId}` : `${t.type}:${t.taskId}`);
