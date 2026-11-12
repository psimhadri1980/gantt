import { createContext, useContext } from 'react';
import type { LinkType } from '@gantt/contract';

/**
 * Every text the Gantt shows (G12). A host passes `messages` to override any of them; dates and numbers
 * are formatted with `Intl` in the host's `locale`, so a translation only needs these strings.
 */
export interface GanttMessages {
  // states
  loading: string;
  empty: string;
  errorTitle: string;
  errorRetry: string;
  // toolbar
  toolbarLabel: string;
  zoomLabel: string;
  zoomLevel: Record<string, string>;
  today: string;
  fit: string;
  showGrid: string;
  hideGrid: string;
  // grid
  colWbs: string;
  colName: string;
  colStart: string;
  colDays: string;
  expand: string;
  collapse: string;
  loadingChildren: string;
  loadFailed: (reason: string) => string;
  openLane: string;
  closeLane: string;
  laneBars: (n: string) => string;
  laneBarsHint: string;
  resizeGrid: string;
  timeline: string;
  unscheduled: string;
  // chart
  todayMarker: string;
  tipWorkingDays: (n: string) => string;
  tipComplete: (pct: string) => string;
  // announcements
  selected: (name: string) => string;
  selectedMany: (name: string, count: string) => string;
  selectionCleared: string;
  connectorName: (from: string, to: string) => string;
  // operations
  readOnly: string;
  // save indicator
  saving: string;
  saved: string;
  notSaved: (reason: string) => string;
  // details
  details: string;
  noLongerExists: string;
  notVisible: (reason: string) => string;
  insideCollapsed: (parent: string) => string;
  outsideView: string;
  typeLane: string;
  typeMilestone: string;
  typeSummary: string;
  typeTask: string;
  typeConnector: string;
  pastDeadline: string;
  derivedDates: string;
  schedule: string;
  date: string;
  start: string;
  end: string;
  duration: string;
  workingDays: (n: string) => string;
  progress: string;
  constraint: string;
  deadline: string;
  mode: string;
  barsOnRow: string;
  children: string;
  childState: Record<'done' | 'in progress' | 'not started' | 'unscheduled', (n: string) => string>;
  placeInTree: string;
  inside: string;
  topLevel: string;
  dependencies: string;
  after: string;
  before: string;
  people: string;
  owner: string;
  otherFields: string;
  linkSentence: Record<LinkType, (from: string, to: string) => string>;
  linkType: Record<LinkType, string>;
  from: string;
  to: string;
  type: string;
  lag: string;
  lagValue: (n: string, unit: 'day' | 'hour') => string;
  none: string;
  notChecked: string;
  satisfied: string;
  satisfiedSpare: (days: string) => string;
  brokenBy: (days: string) => string;
  selection: string;
  items: (n: string) => string;
  tasks: string;
  connectors: string;
  span: string;
  roadmapVersion: (v: string) => string;
  openProposals: string;
  keyboardHint: string;
  diffAdded: string;
  diffChanged: string;
  editHint: string;
  // access (L6)
  noAccess: string;
  // Proposals (section K)
  proposalBar: string;
  viewLabel: string;
  currentView: (version: string) => string;
  currentNone: string;
  versionView: (version: string, by: string, date: string) => string;
  proposalOption: (name: string, state: string, owner: string) => string;
  state: Record<string, string>;
  expires: (date: string, phase: string) => string;
  phaseName: Record<string, string>;
  changesCount: (n: string) => string;
  stale: string;
  compare: string;
  history: string;
  action: Record<'submit' | 'withdraw' | 'review' | 'approve' | 'return' | 'reject' | 'discard' | 'newFrom', string>;
  reasonLabel: string;
  confirm: string;
  cancel: string;
  chooseTarget: string;
  newProposal: string;
  versionReadOnly: string;
  closedReadOnly: (state: string) => string;
  returnedReason: (reason: string) => string;
  historyEntry: (who: string, action: string, date: string) => string;
  // scheduling (Phase 4)
  criticalPath: string;
  scheduleHint: string;
  scheduleUpToDate: string;
  scheduleApplied: (n: string) => string;
  slack: string;
  slackDays: (n: string) => string;
  criticalTask: string;
  drivenBy: string;
  setsDate: string;
  issues: string;
  // editing (Phase 5)
  undo: string;
  redo: string;
  nothingToUndo: string;
  nothingToRedo: string;
  menu: string;
  editDetails: string;
  moveEarlier: string;
  moveLater: string;
  linkFromHere: string;
  linkStart: (name: string) => string;
  linkMade: (from: string, to: string) => string;
  linkCancelled: string;
  linkModeHint: string;
  deleteTask: string;
  deleteDependency: string;
  newTask: string;
  // grid and views (Phase 5 step 2)
  colEnd: string;
  colProgress: string;
  colOwner: string;
  colKind: string;
  colAdd: string;
  addBelow: (name: string) => string;
  addPlaceholder: string;
  addChild: string;
  cut: string;
  copy: string;
  paste: string;
  duplicate: string;
  indent: string;
  outdent: string;
  copied: (n: string) => string;
  pasted: (n: string) => string;
  nothingToPaste: string;
  reorderRow: string;
  reorderNeedsTree: string;
  moved: (name: string) => string;
  sortAsc: string;
  sortDesc: string;
  sortClear: string;
  sortedBy: (col: string, dir: 'asc' | 'desc') => string;
  groupByCol: string;
  groupedBy: (col: string) => string;
  groupLanes: string;
  ungroup: string;
  filterLabel: string;
  filterValues: string;
  filterClear: string;
  filtered: (shown: string, total: string) => string;
  hideColumn: string;
  columns: string;
  columnMenu: (col: string) => string;
  moveLeft: string;
  moveRight: string;
  freezeTo: string;
  resizeColumn: (col: string) => string;
  find: string;
  findPlaceholder: string;
  findCount: (i: string, n: string) => string;
  findNone: string;
  views: string;
  viewDefault: string;
  saveViewAs: string;
  viewName: string;
  deleteView: string;
  compact: string;
  closePanel: string;
  setForAll: (n: string) => string;
  apply: string;
  emptyValue: string;
  selectedBars: (n: string) => string;
  // working together (Phase 6)
  proposals: string;
  colState: string;
  colAge: string;
  colExpires: string;
  colChanges: string;
  colShared: string;
  ageDays: (n: string) => string;
  behind: (n: string) => string;
  refreshProposal: string;
  undoRefresh: string;
  refreshed: (from: string, to: string) => string;
  concurrent: (n: string) => string;
  concurrentTitle: string;
  changedAtOnce: (users: string) => string;
  alsoIn: (name: string) => string;
  anotherProposal: string;
  keepVersion: (user: string) => string;
  groupName: Record<string, string>;
  flagConcurrent: (users: string) => string;
  flagParallel: (name: string) => string;
  flagIncoming: string;
  refreshTitle: (from: string, to: string) => string;
  incomingTitle: string;
  incomingNone: string;
  overlapsTitle: string;
  currentSide: string;
  mineSide: string;
  acceptIncoming: string;
  keepMine: string;
  acceptAll: string;
  keepAll: string;
  perField: string;
  movedTitle: string;
  newIssuesTitle: string;
  backToDraftNote: string;
  confirmRefresh: string;
  deleted: string;
  kindAdded: string;
  kindRemoved: string;
  kindChanged: string;
  undecidedLeft: (n: string) => string;
}

export const defaultMessages: GanttMessages = {
  loading: 'Loading roadmap…',
  empty: 'This roadmap has no tasks yet.',
  errorTitle: 'The roadmap could not be shown',
  errorRetry: 'Try again',
  toolbarLabel: 'Chart navigation',
  zoomLabel: 'Zoom',
  zoomLevel: { year: 'Years', quarter: 'Quarters', month: 'Months', week: 'Weeks', day: 'Days' },
  today: 'Today',
  fit: 'Fit',
  showGrid: 'Show grid',
  hideGrid: 'Hide grid',
  colWbs: 'WBS',
  colName: 'Name',
  colStart: 'Start',
  colDays: 'Days',
  expand: 'Expand',
  collapse: 'Collapse',
  loadingChildren: 'Loading…',
  loadFailed: (reason) => `Could not load: ${reason}. Expand again to retry.`,
  openLane: 'Open lane into rows',
  closeLane: 'Close into lane',
  laneBars: (n) => `${n} bars`,
  laneBarsHint: 'Lane row: its children are drawn as bars on this row',
  resizeGrid: 'Resize grid',
  timeline: 'Timeline: scroll with the arrow keys',
  unscheduled: 'Unscheduled',
  todayMarker: 'Today',
  tipWorkingDays: (n) => `${n} working days`,
  tipComplete: (pct) => `${pct} complete`,
  selected: (name) => `${name} selected`,
  selectedMany: (name, count) => `${name} selected, ${count} items`,
  selectionCleared: 'Selection cleared',
  connectorName: (from, to) => `Connector ${from} to ${to}`,
  readOnly: 'The chart is read-only',
  saving: 'Saving…',
  saved: 'Saved',
  notSaved: (reason) => `Not saved: ${reason}`,
  details: 'Details (F6 to move between chart and details)',
  noLongerExists: 'This item no longer exists.',
  notVisible: (reason) => `Not visible: ${reason}.`,
  insideCollapsed: (parent) => `inside “${parent}”, which is collapsed`,
  outsideView: 'outside the current view',
  typeLane: 'Lane row',
  typeMilestone: 'Milestone',
  typeSummary: 'Summary',
  typeTask: 'Task',
  typeConnector: 'Connector',
  pastDeadline: 'Past deadline',
  derivedDates: 'Dates derived from children',
  schedule: 'Schedule',
  date: 'Date',
  start: 'Start',
  end: 'End',
  duration: 'Duration',
  workingDays: (n) => `${n} working days`,
  progress: 'Progress',
  constraint: 'Constraint',
  deadline: 'Deadline',
  mode: 'Mode',
  barsOnRow: 'Bars on this row',
  children: 'Children',
  childState: { done: (n) => `${n} done`, 'in progress': (n) => `${n} in progress`, 'not started': (n) => `${n} not started`, unscheduled: (n) => `${n} unscheduled` },
  placeInTree: 'Place in tree',
  inside: 'Inside',
  topLevel: 'Top level',
  dependencies: 'Dependencies',
  after: 'After',
  before: 'Before',
  people: 'People',
  owner: 'Owner',
  otherFields: 'Other fields',
  linkSentence: {
    FS: (a, b) => `${a} must finish before ${b} starts`,
    SS: (a, b) => `${a} must start before ${b} starts`,
    FF: (a, b) => `${a} must finish before ${b} finishes`,
    SF: (a, b) => `${a} must start before ${b} finishes`,
  },
  linkType: { FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish' },
  from: 'From',
  to: 'To',
  type: 'Type',
  lag: 'Lag',
  lagValue: (n, unit) => `${n} ${unit === 'hour' ? (n === '1' ? 'hour' : 'hours') : n === '1' ? 'day' : 'days'}`,
  none: 'None',
  notChecked: 'Not checked: a task is unscheduled',
  satisfied: 'Satisfied',
  satisfiedSpare: (d) => `Satisfied with ${d} days to spare`,
  brokenBy: (d) => `Broken by ${d} days`,
  selection: 'Selection',
  items: (n) => `${n} items`,
  tasks: 'Tasks',
  connectors: 'Connectors',
  span: 'Span',
  roadmapVersion: (v) => `Roadmap · version ${v}`,
  openProposals: 'Open proposals',
  diffAdded: 'New',
  diffChanged: 'Changed',
  editHint: 'Changes are saved in a Proposal; Current changes only when it is approved.',
  noAccess: 'You do not have access to this roadmap.',
  proposalBar: 'Roadmap Proposals',
  viewLabel: 'Showing',
  currentView: (v) => `Current (version ${v})`,
  currentNone: 'Current (nothing approved yet)',
  versionView: (v, by, d) => `Version ${v}, approved by ${by} on ${d}`,
  proposalOption: (name, state, owner) => `${name} · ${state} · ${owner}`,
  state: { Draft: 'Draft', Returned: 'Returned', Submitted: 'Submitted', Reviewed: 'Reviewed', Approved: 'Approved', Rejected: 'Rejected', Expired: 'Expired', Discarded: 'Discarded' },
  expires: (d, phase) => `Expires ${d} (${phase})`,
  phaseName: { preparing: 'draft lifetime', review: 'review limit', approval: 'approval limit' },
  changesCount: (n) => `${n} changes`,
  stale: 'Current has changed',
  compare: 'Compare with Current',
  history: 'History',
  action: { submit: 'Submit', withdraw: 'Withdraw', review: 'Mark reviewed', approve: 'Approve', return: 'Return…', reject: 'Reject…', discard: 'Discard', newFrom: 'New Proposal from this' },
  reasonLabel: 'Reason',
  confirm: 'Confirm',
  cancel: 'Cancel',
  chooseTarget: 'Save this change in:',
  newProposal: 'A new Proposal',
  versionReadOnly: 'Earlier versions are read-only',
  closedReadOnly: (state) => `The Proposal is ${state} and cannot be changed`,
  returnedReason: (r) => `Returned: ${r}`,
  historyEntry: (who, action, date) => `${date} · ${who} · ${action}`,
  criticalPath: 'Critical path',
  scheduleHint: 'Apply the calculated dates (successors after their predecessors)',
  scheduleUpToDate: 'The schedule is up to date.',
  scheduleApplied: (n) => `${n} tasks rescheduled.`,
  slack: 'Slack',
  slackDays: (n) => `${n} working days`,
  criticalTask: 'On the critical path',
  drivenBy: 'Start set by',
  setsDate: 'This connector sets the successor’s start',
  issues: 'Schedule issues',
  undo: 'Undo',
  redo: 'Redo',
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  menu: 'Actions',
  editDetails: 'Edit details',
  moveEarlier: 'Move one day earlier',
  moveLater: 'Move one day later',
  linkFromHere: 'Add dependency from here',
  linkStart: (n) => `Linking from ${n}: move to the successor and press Enter, or Esc to cancel.`,
  linkMade: (a, b) => `${a} now comes before ${b}.`,
  linkCancelled: 'Linking cancelled.',
  linkModeHint: 'Linking: choose the successor and press Enter',
  deleteTask: 'Delete task',
  deleteDependency: 'Delete dependency',
  newTask: 'New task',
  colEnd: 'Finish',
  colProgress: 'Done',
  colOwner: 'Owner',
  colKind: 'Kind',
  colAdd: 'Add',
  addBelow: (n) => `Add a task below ${n}`,
  addPlaceholder: 'Add a task…',
  addChild: 'Add sub-task',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  duplicate: 'Duplicate',
  indent: 'Indent',
  outdent: 'Outdent',
  copied: (n) => `${n} copied`,
  pasted: (n) => `${n} pasted`,
  nothingToPaste: 'Nothing to paste',
  reorderRow: 'Drag to move',
  reorderNeedsTree: 'Rows can be moved only in tree order: clear sorting and grouping first',
  moved: (n) => `${n} moved`,
  sortAsc: 'Sort ascending',
  sortDesc: 'Sort descending',
  sortClear: 'Clear sorting',
  sortedBy: (c, d) => `Sorted by ${c}, ${d === 'asc' ? 'ascending' : 'descending'}`,
  groupByCol: 'Group by this column',
  groupedBy: (c) => `Grouped by ${c}`,
  groupLanes: 'Show groups as lanes',
  ungroup: 'Remove grouping',
  filterLabel: 'Filter tasks',
  filterValues: 'Show only',
  filterClear: 'Clear filter',
  filtered: (a, b) => `${a} of ${b} tasks`,
  hideColumn: 'Hide column',
  columns: 'Columns',
  columnMenu: (c) => `${c}: column options`,
  moveLeft: 'Move left',
  moveRight: 'Move right',
  freezeTo: 'Freeze columns up to here',
  resizeColumn: (c) => `Resize ${c}`,
  find: 'Find',
  findPlaceholder: 'Find by name, id or WBS',
  findCount: (i, n) => `${i} of ${n}`,
  findNone: 'No match',
  views: 'View',
  viewDefault: 'Default view',
  saveViewAs: 'Save view as…',
  viewName: 'View name',
  deleteView: 'Delete this view',
  compact: 'Compact',
  closePanel: 'Close',
  setForAll: (n) => `Set for all ${n}`,
  apply: 'Apply',
  emptyValue: '(empty)',
  selectedBars: (n) => `${n} selected`,
  proposals: 'Proposals',
  colState: 'State',
  colAge: 'Age',
  colExpires: 'Expires',
  colChanges: 'Changes',
  colShared: 'Shared tasks',
  ageDays: (n) => `${n} d`,
  behind: (n) => `Current has changed: ${n} newer ${n === '1' ? 'version' : 'versions'}`,
  refreshProposal: 'Refresh Proposal',
  undoRefresh: 'Undo refresh',
  refreshed: (a, b) => `Refreshed from version ${a} to ${b}`,
  concurrent: (n) => `Concurrent changes (${n})`,
  concurrentTitle: 'Concurrent changes',
  changedAtOnce: (u) => `Changed by ${u} at once`,
  alsoIn: (n) => `Also changed in ${n}`,
  anotherProposal: 'another Proposal',
  keepVersion: (u) => `Keep ${u}’s version`,
  groupName: { schedule: 'dates', position: 'place in the tree', delete: 'deleted', name: 'name', progress: 'progress', owner: 'owner' },
  flagConcurrent: (u) => `Changed by ${u} at once: pick a version`,
  flagParallel: (n) => `Also changed in ${n}`,
  flagIncoming: 'Changed in Current since this Proposal was made: refresh to decide',
  refreshTitle: (a, b) => `Refresh from version ${a} to ${b}`,
  incomingTitle: 'Changes in Current, always taken',
  incomingNone: 'Nothing else changed.',
  overlapsTitle: 'Changed on both sides: choose one',
  currentSide: 'Current',
  mineSide: 'Your Proposal',
  acceptIncoming: 'Accept incoming',
  keepMine: 'Keep mine',
  acceptAll: 'Accept all incoming',
  keepAll: 'Keep all mine',
  perField: 'Choose per field',
  movedTitle: 'The recalculated schedule moves',
  newIssuesTitle: 'New scheduling problems',
  backToDraftNote: 'Confirming moves the Proposal back to Draft: submit it again afterwards.',
  confirmRefresh: 'Confirm refresh',
  deleted: 'Deleted',
  kindAdded: 'added',
  kindRemoved: 'deleted',
  kindChanged: 'changed',
  undecidedLeft: (n) => `${n} still to decide`,
  keyboardHint: 'Select a row, bar or connector to see its details. Keyboard: ↑↓ move, ←→ collapse/expand or step through lane bars, Space select, Enter open lane, Esc clear, +/− zoom, T today, F6 details panel.',
};

export function mergeMessages(over?: Partial<GanttMessages>): GanttMessages {
  if (!over) return defaultMessages;
  return {
    ...defaultMessages, ...over,
    zoomLevel: { ...defaultMessages.zoomLevel, ...over.zoomLevel },
    childState: { ...defaultMessages.childState, ...over.childState },
    linkSentence: { ...defaultMessages.linkSentence, ...over.linkSentence },
    linkType: { ...defaultMessages.linkType, ...over.linkType },
    state: { ...defaultMessages.state, ...over.state },
    phaseName: { ...defaultMessages.phaseName, ...over.phaseName },
    action: { ...defaultMessages.action, ...over.action },
    groupName: { ...defaultMessages.groupName, ...over.groupName },
  };
}

export interface I18n { t: GanttMessages; locale?: string; num: (n: number) => string; pct: (v: number) => string }
export function makeI18n(t: GanttMessages, locale?: string): I18n {
  const nf = new Intl.NumberFormat(locale), pf = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return { t, locale, num: (n) => nf.format(n), pct: (v) => pf.format(v) };
}
export const I18nContext = createContext<I18n>(makeI18n(defaultMessages));
export const useI18n = () => useContext(I18nContext);
