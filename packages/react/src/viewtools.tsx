/**
 * View tools (D9–D11, D19): popovers for filter values and columns, the find bar, and the saved-view picker.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SavedView } from '@gantt/state';
import { useI18n } from './i18n.ts';
import type { GridColumn } from './grid.tsx';

/** A small dialog anchored at a point; Esc or a click outside closes it and focus goes back. */
export function Popover({ x, y, label, onClose, children }: { x: number; y: number; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);
  useLayoutEffect(() => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    if (r.right > innerWidth) el.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
    if (r.bottom > innerHeight) el.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
    el.querySelector<HTMLElement>('input, button, select')?.focus();
  }, []);
  // Only on open and close: the caller's onClose changes on every render, and re-running this would move focus away.
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    // The element focused when this opened; focus goes back to it on close.
    const opener = returnTo.current as HTMLElement | null;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) closeRef.current(); };
    window.addEventListener('pointerdown', away, true);
    return () => { window.removeEventListener('pointerdown', away, true); opener?.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <div ref={ref} className="gx-popover" role="dialog" aria-label={label} style={{ left: x, top: y }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      {children}
    </div>
  );
}

/** Pick which values of a column to show (D10). */
export function FilterValues({ label, values, selected, onChange }: { label: string; values: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const { t: m } = useI18n();
  const [sel, setSel] = useState(() => new Set(selected));
  const set = (v: string, on: boolean) => { const n = new Set(sel); on ? n.add(v) : n.delete(v); setSel(n); onChange([...n]); };
  return (
    <fieldset className="gx-filter-values">
      <legend>{m.filterValues}: {label}</legend>
      <div className="gx-filter-list">
        {values.map((v) => (
          <label key={v.value}><input type="checkbox" checked={sel.has(v.value)} onChange={(e) => set(v.value, e.target.checked)} /> {v.label || m.emptyValue}</label>
        ))}
      </div>
      <button className="gx-btn" onClick={() => { setSel(new Set()); onChange([]); }}>{m.filterClear}</button>
    </fieldset>
  );
}

/** Show, hide, reorder and freeze columns (D18). */
export function ColumnsPanel({ all, shown, frozen, onChange }: {
  all: GridColumn[]; shown: GridColumn[]; frozen: number;
  onChange: (shown: GridColumn[], frozen: number) => void;
}) {
  const { t: m } = useI18n();
  const shownIds = new Set(shown.map((c) => c.id));
  const list = [...shown, ...all.filter((c) => !shownIds.has(c.id))];
  const move = (i: number, d: number) => {
    const s = [...shown]; const j = i + d; if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!]; onChange(s, frozen);
  };
  return (
    <div className="gx-columns">
      <ul className="gx-list">
        {list.map((c) => {
          const i = shown.findIndex((x) => x.id === c.id);
          const on = i >= 0;
          return (
            <li key={c.id} className="gx-col-item">
              <label><input type="checkbox" checked={on} disabled={c.id === 'name'}
                onChange={(e) => onChange(e.target.checked ? [...shown.filter((x) => x.id !== 'add'), c, ...shown.filter((x) => x.id === 'add')] : shown.filter((x) => x.id !== c.id), Math.min(frozen, e.target.checked ? shown.length + 1 : shown.length - 1))} /> {c.label}</label>
              {on && <>
                <button className="gx-btn gx-small" aria-label={`${m.moveLeft}: ${c.label}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="gx-btn gx-small" aria-label={`${m.moveRight}: ${c.label}`} disabled={i === shown.length - 1} onClick={() => move(i, 1)}>↓</button>
                <label className="gx-freeze"><input type="radio" name="gx-freeze" checked={frozen === i + 1} onChange={() => onChange(shown, i + 1)} /> {m.freezeTo}</label>
              </>}
            </li>
          );
        })}
      </ul>
      <button className="gx-btn" onClick={() => onChange(shown, 0)} aria-pressed={frozen === 0}>{m.filterClear}: {m.freezeTo}</button>
    </div>
  );
}

/** Find a task by name, id or WBS and jump to it (D19). */
export function FindBar({ count, index, onQuery, onStep, onClose, inputRef }: {
  count: number; index: number; onQuery: (q: string) => void; onStep: (d: 1 | -1) => void; onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t: m, num } = useI18n();
  const [q, setQ] = useState('');
  return (
    <span className="gx-find" role="search">
      <input ref={inputRef} className="gx-input" type="search" aria-label={m.find} placeholder={m.findPlaceholder} value={q} autoFocus
        onChange={(e) => { setQ(e.target.value); onQuery(e.target.value); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }} />
      <span className="gx-muted" role="status" aria-live="polite">{q.trim() ? (count ? m.findCount(num(index + 1), num(count)) : m.findNone) : ''}</span>
      <button className="gx-btn gx-small" aria-label={`${m.find} ↑`} aria-disabled={!count || undefined} onClick={() => onStep(-1)}>↑</button>
      <button className="gx-btn gx-small" aria-label={`${m.find} ↓`} aria-disabled={!count || undefined} onClick={() => onStep(1)}>↓</button>
      <button className="gx-btn gx-small" aria-label={m.closePanel} onClick={onClose}>×</button>
    </span>
  );
}

/** Saved views (F12): pick one, save the current view under a name, or delete the chosen one. */
export function ViewPicker({ views, current, onPick, onSave, onDelete }: {
  views: SavedView[]; current: string | null; onPick: (id: string | null) => void; onSave: (name: string) => void; onDelete: (id: string) => void;
}) {
  const { t: m } = useI18n();
  const [naming, setNaming] = useState(false);
  return (
    <span className="gx-views">
      <select id="gx-view-pick" className="gx-select" value={current ?? ''} aria-label={m.views}
        onChange={(e) => { if (e.target.value === '\u0000save') { setNaming(true); return; } onPick(e.target.value || null); }}>
        <option value="">{m.viewDefault}</option>
        {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        <option value={'\u0000save'}>{m.saveViewAs}</option>
      </select>
      {naming && <input className="gx-input" aria-label={m.viewName} placeholder={m.viewName} autoFocus
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && e.currentTarget.value.trim()) { onSave(e.currentTarget.value.trim()); setNaming(false); }
          if (e.key === 'Escape') setNaming(false);
        }} onBlur={() => setNaming(false)} />}
      {current && <button className="gx-btn gx-small" aria-label={m.deleteView} title={m.deleteView} onClick={() => onDelete(current)}>🗑</button>}
    </span>
  );
}
