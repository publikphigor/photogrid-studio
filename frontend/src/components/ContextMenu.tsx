import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/** A menu item rendered by `<ContextMenu>`. `onSelect` runs after the menu
 *  closes; `disabled` greys it out and ignores clicks; `danger` tints it red
 *  for destructive actions. `divider: true` instead of a label inserts a
 *  thin separator. */
export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

interface Props {
  /** Anchor point in viewport coordinates (`event.clientX/Y`). The menu is
   *  positioned at this point and then nudged inwards if it would overflow
   *  the viewport. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/** Lightweight viewport-aware context menu. Renders into `document.body` via
 *  a portal so it isn't clipped by any ancestor `overflow:hidden`. Closes on
 *  outside click, Escape, or scroll. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;
    let left = x;
    let top = y;
    if (left + r.width + margin > vw) left = Math.max(margin, vw - r.width - margin);
    if (top + r.height + margin > vh) top = Math.max(margin, vh - r.height - margin);
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    setPos({ left, top });
  }, [x, y, items.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('contextmenu', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('contextmenu', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  const style: CSSProperties = {
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    minWidth: 200,
    background: 'var(--panel)',
    border: '1px solid var(--line-strong)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-2)',
    padding: 4,
    zIndex: 1000,
    fontSize: 12.5,
    color: 'var(--text)',
  };

  return createPortal(
    <div ref={ref} role="menu" style={style}>
      {items.map((item) =>
        item.divider ? (
          <div
            key={item.id}
            aria-hidden
            style={{ height: 1, background: 'var(--line)', margin: '4px 2px' }}
          />
        ) : (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 10px',
              borderRadius: 4,
              background: 'transparent',
              border: 0,
              color: item.danger ? 'var(--danger)' : 'var(--text)',
              opacity: item.disabled ? 0.4 : 1,
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              fontSize: 12.5,
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              (e.currentTarget as HTMLElement).style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            {item.icon && (
              <span
                aria-hidden
                style={{
                  width: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: item.danger ? 'var(--danger)' : 'var(--text-3)',
                }}
              >
                {item.icon}
              </span>
            )}
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10.5,
                  color: 'var(--text-4)',
                  marginLeft: 8,
                }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
