import { formatBytes } from '@/state/presets';
import type { ExportPhase } from '@/api/client';

export interface ExportBatchState {
  phase: ExportPhase;
  bytes: number;
  total: number;
  elapsedMs: number;
}

interface Props {
  progress: ExportBatchState | null;
}

export function ExportProgress({ progress }: Props) {
  if (!progress) return null;
  const { phase, bytes, total, elapsedMs } = progress;
  const seconds = (elapsedMs / 1000).toFixed(1);
  const pct = phase === 'download' && total > 0
    ? Math.min(100, Math.round((bytes / total) * 100))
    : null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        minWidth: 280,
        maxWidth: 'calc(100vw - 48px)',
        padding: '10px 14px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        fontSize: 12.5,
        color: 'var(--text)',
        pointerEvents: 'none',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>
          {phase === 'render' ? 'Rendering…' : 'Downloading'}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)' }}>
          {phase === 'render'
            ? `${seconds}s`
            : total > 0
              ? `${formatBytes(bytes)} / ${formatBytes(total)} · ${pct}%`
              : formatBytes(bytes)}
        </span>
      </div>
      {phase === 'render' && (
        <div
          style={{
            color: 'var(--text-3)',
            fontSize: 11.5,
            marginBottom: 8,
          }}
        >
          This might take a while
        </div>
      )}
      <div
        style={{
          height: 4,
          borderRadius: 4,
          background: 'var(--line)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: phase === 'download' && pct != null ? `${pct}%` : '100%',
            background: 'var(--accent)',
            transition: 'width 120ms linear',
            animation: phase === 'render' ? 'pg-indeterminate 1.2s ease-in-out infinite' : undefined,
            transformOrigin: 'left',
          }}
        />
      </div>
      <style>{`
        @keyframes pg-indeterminate {
          0%   { transform: scaleX(0.15); opacity: 0.6; }
          50%  { transform: scaleX(1);    opacity: 1; }
          100% { transform: scaleX(0.15); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
