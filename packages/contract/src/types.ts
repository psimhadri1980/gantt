/** Contract `gantt-roadmap/1` (plan section 3b). */
export const CONTRACT_NAME = 'gantt-roadmap';
export const CONTRACT_MAJOR = 1;
export const CONTRACT_ID = `${CONTRACT_NAME}/${CONTRACT_MAJOR}` as const;

/** ISO date `YYYY-MM-DD` in the roadmap's time zone. */
export type IsoDate = string;

export type TaskType = 'task' | 'summary' | 'milestone';
export type TaskMode = 'auto' | 'manual' | 'inactive';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type DurationUnit = 'day' | 'hour';
export type ConstraintType = 'ASAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export interface Roadmap {
  id: string;
  name: string;
  version: number;
  timeZone: string;
  start: IsoDate;
  defaultCalendar?: string;
  statusDate?: IsoDate;
}

export interface Calendar {
  id: string;
  name: string;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  hoursPerDay?: number;
  holidays?: IsoDate[];
}

export interface ResourceAssignment { id: string; allocation: number }

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  parent: string | null;
  kind?: string;
  lane?: boolean;
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
  [extra: string]: unknown;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  kind?: string;
  lag?: number;
  lagUnit?: DurationUnit;
}

export interface Resource { id: string; name: string; capacityFte?: number; calendar?: string }

export interface ProposalChange {
  entity: 'task' | 'link' | 'resource' | 'calendar' | 'roadmap';
  op: 'create' | 'update' | 'delete';
  id: string;
  fields?: Record<string, unknown>;
  by: string;
  at: string;
}

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

export interface AccessConfig {
  subject: { id: string; roles: string[] };
  rules: { effect: 'allow' | 'deny'; permissions: string[]; [k: string]: unknown }[];
}

export interface RoadmapDocument {
  contract: string;
  roadmap: Roadmap;
  calendars?: Calendar[];
  tasks: Task[];
  links: Link[];
  resources?: Resource[];
  proposals?: Proposal[];
  access?: AccessConfig;
}
