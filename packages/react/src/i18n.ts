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
  };
}

export interface I18n { t: GanttMessages; locale?: string; num: (n: number) => string; pct: (v: number) => string }
export function makeI18n(t: GanttMessages, locale?: string): I18n {
  const nf = new Intl.NumberFormat(locale), pf = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return { t, locale, num: (n) => nf.format(n), pct: (v) => pf.format(v) };
}
export const I18nContext = createContext<I18n>(makeI18n(defaultMessages));
export const useI18n = () => useContext(I18nContext);
