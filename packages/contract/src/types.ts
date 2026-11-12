/**
 * The roadmap document (contract "gantt-roadmap/1"): the TypeScript form of schema/gantt-roadmap-1.schema.json.
 * Dates are ISO strings (YYYY-MM-DD); durations are working days (or hours with durationUnit 'hour').
 */
/** Contract `gantt-roadmap/1` (plan section 3b). */
export const CONTRACT_NAME = 'gantt-roadmap';
export const CONTRACT_MAJOR = 1;
export const CONTRACT_ID = `${CONTRACT_NAME}/${CONTRACT_MAJOR}` as const;

/** ISO date `YYYY-MM-DD` in the roadmap's time zone. */
export type IsoDate = string;

/** A plain task, a summary (spans its children) or a milestone (a point in time). */
export type TaskType = 'task' | 'summary' | 'milestone';
/** Auto: scheduled from dependencies and constraints. Manual: keeps the dates given. Inactive: kept but ignored. */
export type TaskMode = 'auto' | 'manual' | 'inactive';
/** Dependency type: finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
/** Whether a task's duration counts working days or working hours. */
export type DurationUnit = 'day' | 'hour';
/**
 * Scheduling constraints: as soon as possible, start no earlier/later than, finish no earlier/later than,
 * must start on, must finish on (the date is in `constraintDate`).
 */
export type ConstraintType = 'ASAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

/** The roadmap's own settings: identity, name, version, time zone, start date and default calendar. */
export interface Roadmap {
  id: string;
  name: string;
  version: number;
  timeZone: string;
  start: IsoDate;
  defaultCalendar?: string;
  statusDate?: IsoDate;
  /** Capacity in FTE that people without resource data are measured against (E7); omit for none. */
  defaultCapacityFte?: number;
}

/** A working-time calendar: worked weekdays, holidays and hours per day. */
export interface Calendar {
  id: string;
  name: string;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  hoursPerDay?: number;
  holidays?: IsoDate[];
}

/** A resource on a task, with the share of their time it takes (1 = full time). */
export interface ResourceAssignment { id: string; allocation: number }

/**
 * One task: its place in the tree (`parent`, `order`), its dates and duration, how it is scheduled, progress,
 * owner and kind, and optional resources, calendar, deadline, splits and custom fields.
 */
export interface Task {
  id: string;
  name: string;
  type: TaskType;
  parent: string | null;
  kind?: string;
  lane?: boolean;
  /** Position among siblings, ascending (D2). Tasks without it keep their place in the array. */
  order?: number;
  /** The task has children that are loaded on demand (H2); omit once they are present. */
  hasChildren?: boolean;
  start?: IsoDate;
  duration?: number;
  durationUnit?: DurationUnit;
  end?: IsoDate;
  progress?: number;
  mode?: TaskMode;
  owner?: string;
  resources?: ResourceAssignment[];
  constraint?: { type: ConstraintType; date?: IsoDate };
  deadline?: IsoDate;
  /** Calendar for this task's working time, instead of the roadmap's (C8). */
  calendar?: string;
  /** Split task (D12): after `after` working days of work, a pause of `gap` working days; in order. */
  splits?: { after: number; gap: number }[];
  [extra: string]: unknown;
}

/** A dependency between two tasks: `target` waits for `source` according to `type`, plus `lag` working days. */
export interface Link {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  kind?: string;
  lag?: number;
  lagUnit?: DurationUnit;
}

/** A person or team that work can be assigned to, with their capacity in full-time equivalents. */
export interface Resource { id: string; name: string; capacityFte?: number; calendar?: string }

/**
 * One change inside a Proposal: create, update or delete a task, link, resource, calendar or the roadmap settings.
 */
export interface ProposalChange {
  entity: 'task' | 'link' | 'resource' | 'calendar' | 'roadmap';
  op: 'create' | 'update' | 'delete';
  id: string;
  fields?: Record<string, unknown>;
  by: string;
  at: string;
}

/** A Proposal as stored in a document: a named set of changes with its state and history. */
export interface Proposal {
  id: string;
  name: string;
  owner: string;
  state: string;
  baseVersion: number;
  createdAt: string;
  submittedAt?: string;
  expiresAt?: string;
  changes: ProposalChange[];
}

/** Access rules shipped inside a document (used by the mock data and the demo). */
export interface AccessConfig {
  subject: { id: string; roles: string[] };
  rules: { effect: 'allow' | 'deny'; permissions: string[]; [k: string]: unknown }[];
}

/**
 * The whole roadmap as exchanged with the component, the server and files: the contract version, the roadmap
 * settings, tasks, links and the optional parts (calendars, resources, baselines, Proposals, access).
 */
export interface RoadmapDocument {
  contract: string;
  roadmap: Roadmap;
  calendars?: Calendar[];
  tasks: Task[];
  links: Link[];
  resources?: Resource[];
  proposals?: Proposal[];
  access?: AccessConfig;
  /** Saved plans to compare with (B1): snapshots of a version of Current. */
  baselines?: Baseline[];
}

/** A snapshot of the plan at a version of Current (B1, K22). Saving one does not change the plan. */
export interface Baseline {
  id: string;
  name: string;
  /** The version of Current it was taken from. */
  version: number;
  savedAt: string;
  savedBy: string;
  tasks: { id: string; start: IsoDate; end: IsoDate; work: number }[];
}
