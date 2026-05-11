import { formatBytes } from '@/state/presets';

export interface UploadBatchState {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  activeNames: string[];
}

interface Props {
  progress: UploadBatchState | null;
}

export function UploadProgress({ progress }: Props) {
  if (!progress) return null;
  const { done, total, bytes, totalBytes, activeNames } = progress;
  const pct = totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : 0;
  const label = activeNames.length === 1
    ? activeNames[0]
    : activeNames.length > 1
      ? `${activeNames[0]} +${activeNames.length - 1}`
      : '';
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
          Uploading {done}/{total}
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-3)' }}>
          {totalBytes > 0
            ? `${formatBytes(bytes)} / ${formatBytes(totalBytes)} · ${pct}%`
            : formatBytes(bytes)}
        </span>
      </div>
      {label && (
        <div
          title={activeNames.join('\n')}
          style={{
            color: 'var(--text-3)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 8,
            fontSize: 11.5,
          }}
        >
          {label}
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
            width: `${pct}%`,
            background: 'var(--accent)',
            transition: 'width 120ms linear',
          }}
        />
      </div>
    </div>
  );
}
