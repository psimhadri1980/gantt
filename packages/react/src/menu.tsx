/**
 * Context menus (F9): keyboard navigable, with disabled entries that say why, closed by Esc or a click outside.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

/** One entry of a context menu: its label and action, or why it is disabled; optionally a shortcut hint, a check mark, or a separator. */
export interface MenuItem {
  label: string;
  run?: () => void;
  /** Disabled, with the reason (F14). */
  why?: string | null;
  shortcut?: string;
  checked?: boolean;
  /** An on/off option: shown as a checkbox item, and the menu stays open so several can be switched in a row. */
  toggle?: boolean;
  separator?: boolean;
  /** A group title (not focusable), such as "Analysis" above the options it groups. */
  heading?: boolean;
}

/**
 * Context menu (D8). Fixed-position over everything, so a host container with clipped overflow cannot cut
 * it off. Arrow keys move, Enter runs, Esc or a click outside closes; focus returns to where it was.
 */
export function ContextMenu({ x, y, items, onClose, label }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);
  useLayoutEffect(() => {
    const el = ref.current!; const r = el.getBoundingClientRect();
    if (r.right > innerWidth) el.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
    if (r.bottom > innerHeight) el.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
    el.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
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
  const onKey = (e: React.KeyboardEvent) => {
    const all = [...ref.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') all[(i + 1) % all.length]?.focus();
    else if (e.key === 'ArrowUp') all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all[all.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  return (
    <div ref={ref} className="gx-menu" role="menu" aria-label={typeof label === 'string' ? label : undefined} style={{ left: x, top: y }} onKeyDown={onKey}>
      {items.map((it, i) => it.separator ? <div key={i} role="separator" className="gx-menu-sep" />
        : it.heading ? <div key={i} role="presentation" className="gx-menu-heading">{it.label}</div> : (
        <button key={i} role={it.toggle ? 'menuitemcheckbox' : it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
          aria-checked={it.toggle ? !!it.checked : it.checked} className={`gx-menu-item${it.toggle ? ' gx-menu-toggle' : ''}`}
          aria-disabled={!!it.why || undefined} title={it.why ?? undefined} tabIndex={-1}
          onClick={() => { if (it.why) return; if (!it.toggle) onClose(); it.run?.(); }}>
          <span>{it.toggle ? <span className="gx-check" aria-hidden>{it.checked ? '✓' : ''}</span> : it.checked ? '✓ ' : ''}{it.label}</span>{it.shortcut && <kbd>{it.shortcut}</kbd>}
          {it.why && <span className="gx-sr">{it.why}</span>}
        </button>
      ))}
    </div>
  );
}
