export type SelectionTarget =
  | { type: 'row'; taskId: string }
  | { type: 'bar'; taskId: string; bar: string }
  | { type: 'link'; linkId: string };

export const sameTarget = (a: SelectionTarget, b: SelectionTarget) =>
  a.type === b.type && (a.type === 'link' ? a.linkId === (b as typeof a).linkId : a.taskId === (b as { taskId: string }).taskId);
export const targetKey = (t: SelectionTarget) => (t.type === 'link' ? `link:${t.linkId}` : `${t.type}:${t.taskId}`);
