import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../schema/gantt-roadmap-1.schema.json';
import small from '../../mock/src/samples/small.json';
import { generate } from '../../mock/src/generate.ts';
import { validate } from './index.ts';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const check = ajv.compile(schema);

const variants: [string, (d: Record<string, any>) => void][] = [
  ['bad date', (d) => { d.tasks[1].start = 'soon'; }],
  ['unknown task type', (d) => { d.tasks[1].type = 'epic'; }],
  ['progress above 1', (d) => { d.tasks[1].progress = 1.5; }],
  ['milestone with a duration', (d) => { d.tasks[3].duration = 2; }],
  ['task with start but no duration or end', (d) => { delete d.tasks[2].duration; }],
  ['bad link type', (d) => { d.links[0].type = 'XX'; }],
  ['missing parent', (d) => { delete d.tasks[0].parent; }],
  ['constraint without a date', (d) => { d.tasks[1].constraint = { type: 'MSO' }; }],
  ['empty working days', (d) => { d.calendars[0].workingDays = []; }],
  ['wrong contract', (d) => { d.contract = 'gantt-roadmap/2'; }],
];

describe('published JSON Schema', () => {
  it('accepts the bundled and generated samples', () => {
    expect(check(small), JSON.stringify(check.errors?.slice(0, 2))).toBe(true);
    expect(check(generate({ tasks: 500, laneEvery: 2 }))).toBe(true);
  });
  it.each(variants)('agrees with validate() in refusing: %s', (_name, mutate) => {
    const d = structuredClone(small) as Record<string, any>;
    mutate(d);
    expect(check(d)).toBe(false);
    expect(validate(d).ok).toBe(false);
  });
  it('allows unknown fields (validate() reports them as warnings)', () => {
    const d = structuredClone(small) as Record<string, any>;
    d.tasks[1].colour = 'red';
    expect(check(d)).toBe(true);
    const r = validate(d);
    expect(r.ok && r.warnings.some((w) => w.path === 'tasks[1].colour')).toBe(true);
  });
});
