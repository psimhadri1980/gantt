import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@gantt/contract';
import type { RefreshChoice } from '@gantt/proposals';
import type { Concurrency, ProposalSummary, RefreshPreview, Snapshot } from '@gantt/service';
import { fmtDate } from './grid.tsx';
import { makeI18n, type GanttMessages } from './i18n.ts';

/**
 * Working together on Proposals (Phase 6): the Proposal list (K11), the "Concurrent changes" panel with
 * picks (K8, K9), and the refresh preview (K16–K17c). Plain components over data from the backend.
 */

const DAY = 86_400_000;
/** The display name of a field group ("schedule", "progress"…), or the group id when there is none. */
const groupText = (m: GanttMessages, g: string) => m.groupName[g] ?? g;

/** The Proposals of this roadmap with owner, state, age, expiry, changes and shared tasks (K11). */
export function ProposalList({ snap, m, locale, now, open, refresh }: {
  snap: Snapshot; m: GanttMessages; locale?: string; now: number;
  open: (id: string) => void; refresh: (p: ProposalSummary) => void;
}) {
  const { num } = makeI18n(m, locale);
  const day = (iso?: string) => (iso ? fmtDate(Math.floor(Date.parse(iso) / DAY), locale) : '—');
  if (!snap.proposals.length) return <p className="gx-muted">{m.empty}</p>;
  return (
    <table className="gx-plist">
      <thead><tr>
        <th scope="col">{m.colName}</th><th scope="col">{m.colOwner}</th><th scope="col">{m.colState}</th><th scope="col">{m.colAge}</th>
        <th scope="col">{m.colExpires}</th><th scope="col">{m.colChanges}</th><th scope="col">{m.colShared}</th><th scope="col"><span className="gx-sr">{m.refreshProposal}</span></th>
      </tr></thead>
      <tbody>
        {snap.proposals.map((p) => {
          return (
            <tr key={p.id} data-proposal={p.id}>
              <th scope="row"><button className="gx-link-btn" onClick={() => open(p.id)}>{p.name}</button></th>
              <td>{p.owner}</td>
              <td><span className={`gx-chip gx-state gx-state-${p.state.toLowerCase()}`}>{m.state[p.state] ?? p.state}</span>
                {p.stale && <span className="gx-chip gx-warn" title={m.behind(num(p.behind))}> {m.stale} ({num(p.behind)})</span>}</td>
              <td>{m.ageDays(num(Math.max(0, Math.floor((now - Date.parse(p.createdAt)) / DAY))))}</td>
              <td>{p.phase ? day(p.expiresAt) : '—'}</td>
              <td>{num(p.changeCount)}</td>
              <td>{p.shared ? <span className="gx-chip gx-warn">{num(p.shared)}</span> : num(0)}</td>
              <td>{p.stale && <button className="gx-btn gx-small" onClick={() => refresh(p)}>{m.refreshProposal}</button>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The fields of a task that belong to the given groups, as "field: value" lines. */
const fieldsOf = (t: Task | null, groups: string[]) => {
  if (!t) return [];
  const keys = Object.keys(t).filter((k) => k !== 'id' && groups.some((g) => g === k || (g === 'schedule' && ['start', 'end', 'duration', 'durationUnit', 'constraint'].includes(k)) || (g === 'position' && ['parent', 'order'].includes(k))));
  return keys.map((k) => `${k}: ${JSON.stringify((t as Record<string, unknown>)[k])}`);
};
/** One person's version of a task, limited to the fields in conflict (or "deleted"). */
function TaskVersion({ task, groups, m }: { task: Task | null; groups: string[]; m: GanttMessages }) {
  if (!task) return <em>{m.deleted}</em>;
  const lines = fieldsOf(task, groups);
  return <>{lines.length ? lines.map((l) => <div key={l} className="gx-mono">{l}</div>) : <span className="gx-muted">—</span>}</>;
}

/** Tasks changed by two people at once in this Proposal, and those shared with parallel Proposals (K8, K9). */
export function ConcurrentPanel({ cc, m, canPick, pick, select }: {
  cc: Concurrency; m: GanttMessages; canPick: string | null;
  pick: (taskId: string, keep: string) => void; select: (taskId: string) => void;
}) {
  return (
    <div className="gx-concurrent">
      {cc.inProposal.length > 0 && <ul className="gx-list">
        {cc.inProposal.map((c) => (
          <li key={c.taskId} className="gx-cc-item" data-task={c.taskId}>
            <div><button className="gx-link-btn" onClick={() => select(c.taskId)}>{c.name}</button> · {c.groups.map((g) => groupText(m, g)).join(', ')}</div>
            <div className="gx-muted">{m.changedAtOnce(c.users.join(', '))}</div>
            <div className="gx-cc-versions">
              {c.versions.map((v) => (
                <div key={v.user} className="gx-cc-version">
                  <strong>{v.user}</strong>
                  <TaskVersion task={v.task} groups={c.groups} m={m} />
                  <button className="gx-btn gx-small" aria-disabled={!!canPick || undefined} title={canPick ?? undefined}
                    onClick={() => { if (!canPick) pick(c.taskId, v.user); }}>{m.keepVersion(v.user)}</button>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>}
      {cc.parallel.length > 0 && <ul className="gx-list">
        {cc.parallel.map((o, i) => (
          <li key={o.taskId + i} className="gx-cc-item gx-cc-parallel">
            <button className="gx-link-btn" onClick={() => select(o.taskId)}>{o.name}</button> · {o.groups.map((g) => groupText(m, g)).join(', ')}
            <div className="gx-muted">{m.alsoIn(o.proposal ? `${o.proposal.name} (${o.proposal.owner})` : m.anotherProposal)}</div>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/**
 * Refresh preview (K17): incoming changes for information, every overlap side by side with a choice (per task,
 * or per field group when expanded), the recalculated schedule, then one confirm. Choices live in `choices`,
 * which the caller keeps, so leaving and coming back resumes them (K17c).
 */
export function RefreshDialog({ preview, choices, setChoices, m, onConfirm, onCancel, busy, error }: {
  preview: RefreshPreview; choices: Record<string, RefreshChoice>; setChoices: (c: Record<string, RefreshChoice>) => void;
  m: GanttMessages; onConfirm: () => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const opener = returnTo.current as HTMLElement | null; // focus returns here when the dialog closes
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    return () => { opener?.focus?.({ preventScroll: true }); };
  }, []);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(Object.entries(choices).filter(([, c]) => typeof c === 'object').map(([k]) => k)));
  const all = (v: 'incoming' | 'mine') => setChoices(Object.fromEntries(preview.overlaps.map((o) => [o.taskId, v])));
  const value = (taskId: string, g?: string): 'incoming' | 'mine' | undefined => {
    const c = choices[taskId];
    if (c === undefined) return undefined;
    if (typeof c === 'string') return c;
    return g ? c[g] : undefined;
  };
  const setOne = (taskId: string, v: 'incoming' | 'mine', g?: string) => {
    if (!g) { setChoices({ ...choices, [taskId]: v }); return; }
    const cur = choices[taskId];
    const o = preview.overlaps.find((x) => x.taskId === taskId)!;
    // Expanding keeps a per-task answer as the answer for each group.
    const base: Record<string, 'incoming' | 'mine'> = typeof cur === 'object' ? { ...cur } : cur ? Object.fromEntries(o.groups.map((x) => [x, cur])) : {};
    base[g] = v;
    setChoices({ ...choices, [taskId]: base });
  };
  const left = preview.undecided.length;
  const kind = { added: m.kindAdded, removed: m.kindRemoved, changed: m.kindChanged };
  const sorted = useMemo(() => [...preview.incoming].sort((a, b) => a.name.localeCompare(b.name)), [preview.incoming]);
  return (
    <div className="gx-modal-back">
      <div ref={ref} className="gx-modal" role="dialog" aria-modal="true" aria-labelledby="gx-refresh-title"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
        <h2 id="gx-refresh-title" tabIndex={-1}>{m.refreshTitle(String(preview.fromVersion), String(preview.toVersion))}</h2>
        <section>
          <h3>{m.overlapsTitle}</h3>
          {preview.overlaps.length === 0 ? <p className="gx-muted">—</p> : <>
            <div className="gx-row-actions">
              <button className="gx-btn gx-small" onClick={() => all('incoming')}>{m.acceptAll}</button>
              <button className="gx-btn gx-small" onClick={() => all('mine')}>{m.keepAll}</button>
              {left > 0 && <span className="gx-chip gx-warn" role="status">{m.undecidedLeft(String(left))}</span>}
            </div>
            <ul className="gx-list gx-overlaps">
              {preview.overlaps.map((o) => {
                const open = expanded.has(o.taskId);
                return (
                  <li key={o.taskId} className={`gx-overlap${preview.undecided.includes(o.taskId) ? ' gx-undecided' : ''}`} data-task={o.taskId}>
                    <div className="gx-overlap-head"><strong>{o.name}</strong> · {o.groups.map((g) => groupText(m, g)).join(', ')}</div>
                    <div className="gx-sides">
                      <div className="gx-side"><div className="gx-side-label">{m.currentSide}</div><TaskVersion task={o.current} groups={o.groups} m={m} /></div>
                      <div className="gx-side"><div className="gx-side-label">{m.mineSide}</div><TaskVersion task={o.mine} groups={o.groups} m={m} /></div>
                    </div>
                    {!open ? (
                      <fieldset className="gx-choice"><legend className="gx-sr">{o.name}</legend>
                        <label><input type="radio" name={`gx-ch-${o.taskId}`} checked={value(o.taskId) === 'incoming'} onChange={() => setOne(o.taskId, 'incoming')} /> {m.acceptIncoming}</label>
                        <label><input type="radio" name={`gx-ch-${o.taskId}`} checked={value(o.taskId) === 'mine'} onChange={() => setOne(o.taskId, 'mine')} /> {m.keepMine}</label>
                        {o.groups.length > 1 && <button className="gx-btn gx-small" onClick={() => setExpanded(new Set([...expanded, o.taskId]))}>{m.perField}</button>}
                      </fieldset>
                    ) : o.groups.map((g) => {
                      const v = value(o.taskId, g);
                      return (
                        <fieldset key={g} className="gx-choice"><legend>{groupText(m, g)}</legend>
                          <label><input type="radio" name={`gx-ch-${o.taskId}-${g}`} checked={v === 'incoming'} onChange={() => setOne(o.taskId, 'incoming', g)} /> {m.acceptIncoming}</label>
                          <label><input type="radio" name={`gx-ch-${o.taskId}-${g}`} checked={v === 'mine'} onChange={() => setOne(o.taskId, 'mine', g)} /> {m.keepMine}</label>
                        </fieldset>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          </>}
        </section>
        <section>
          <h3>{m.incomingTitle}</h3>
          {sorted.length ? <ul className="gx-list gx-incoming">{sorted.map((c) => <li key={c.taskId}>{c.name} · {kind[c.kind]}{c.groups.length > 0 && c.kind === 'changed' ? ` (${c.groups.map((g) => groupText(m, g)).join(', ')})` : ''}{c.by ? ` · ${c.by}` : ''}</li>)}</ul>
            : <p className="gx-muted">{m.incomingNone}</p>}
        </section>
        {(preview.moved.length > 0 || preview.newIssues.length > 0) && <section>
          {preview.moved.length > 0 && <><h3>{m.movedTitle}</h3><ul className="gx-list">{preview.moved.map((x) => <li key={x.taskId}>{x.name}: {x.from ?? '—'} → {x.to}</li>)}</ul></>}
          {preview.newIssues.length > 0 && <><h3>{m.newIssuesTitle}</h3><ul className="gx-list">{preview.newIssues.map((x) => <li key={x} className="gx-warn-text">{x}</li>)}</ul></>}
        </section>}
        {preview.backToDraft && <p className="gx-note">{m.backToDraftNote}</p>}
        {error && <p className="gx-note gx-warn-text" role="alert">{error}</p>}
        <div className="gx-modal-actions">
          <button className="gx-btn gx-primary" aria-disabled={left > 0 || busy || undefined} title={left ? m.undecidedLeft(String(left)) : undefined}
            onClick={() => { if (!left && !busy) onConfirm(); }}>{m.confirmRefresh}</button>
          <button className="gx-btn" onClick={onCancel}>{m.cancel}</button>
        </div>
      </div>
    </div>
  );
}
