import { useEffect, useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import type { Action, FormatId, OutputConfig, PhotoGridState } from '@/types';
import { dimensionsFor, estimateFileSize, formatBytes } from '@/state/presets';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import {
  clearFolder,
  FolderPickerError,
  getStoredFolder,
  pickFolder,
  supportsFolderPicker,
  type DirHandleLike,
} from '@/api/folder';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
  exportInfo: { lastSize?: number; rendererName?: string; elapsedMs?: number };
}

export function OutputTab({ state, dispatch, exportInfo }: Props) {
  const o = state.output;
  const dims = dimensionsFor(state.container.aspect, o.baseSize);
  const outW = Math.round(dims.w * o.scale);
  const outH = Math.round(dims.h * o.scale);
  const estimate = estimateFileSize(outW, outH, o.format, o.quality);
  const set = (patch: Partial<OutputConfig>) => dispatch({ type: 'SET_OUTPUT', patch });

  return (
    <>
      <div className="section">
        <h4 className="section-title">File</h4>
        <div className="row">
          <label>Name</label>
          <label className="field">
            <input
              type="text"
              value={o.filename}
              spellCheck={false}
              onChange={(e) => set({ filename: e.target.value.replace(/[/\\:*?"<>|]/g, '') })}
              placeholder="PG_xxxxx"
            />
            <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              .{o.format}
            </span>
          </label>
        </div>
        <FolderRow />
      </div>

      <div className="section">
        <h4 className="section-title">Format</h4>
        <Seg
          options={[
            { value: 'png' as FormatId, label: 'PNG' },
            { value: 'jpg' as FormatId, label: 'JPG' },
            { value: 'webp' as FormatId, label: 'WEBP' },
            { value: 'svg' as FormatId, label: 'SVG' },
          ]}
          value={o.format}
          onChange={(v) => set({ format: v })}
        />
        <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '10px 0 0', lineHeight: 1.55 }}>
          {o.format === 'png' && 'Lossless · supports transparency · larger files'}
          {o.format === 'jpg' && 'Lossy · smaller · best for photos · no transparency'}
          {o.format === 'webp' && 'Modern · ~30% smaller than JPG · supports transparency'}
          {o.format === 'svg' && 'SVG wrapper around the rendered PNG · scales without re-render'}
        </p>
      </div>

      <div className="section">
        <h4 className="section-title">Size</h4>
        <div className="row">
          <label>Base size</label>
          <Slider
            value={o.baseSize}
            min={400}
            max={4000}
            step={100}
            onChange={(v) => set({ baseSize: v })}
            suffix="px"
          />
        </div>
        <div className="row">
          <label>Scale</label>
          <Seg
            options={[
              { value: 1, label: '1×' },
              { value: 2, label: '2×' },
              { value: 3, label: '3×' },
              { value: 4, label: '4×' },
            ]}
            value={o.scale}
            onChange={(v) => set({ scale: v as 1 | 2 | 3 | 4 })}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            marginTop: 6,
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
          }}
        >
          <span style={{ color: 'var(--text-3)' }}>Output</span>
          <span>
            <b style={{ color: 'var(--text)' }}>{outW}</b> ×{' '}
            <b style={{ color: 'var(--text)' }}>{outH}</b> px
          </span>
        </div>
      </div>

      {(o.format === 'jpg' || o.format === 'webp') && (
        <div className="section">
          <h4 className="section-title">Quality</h4>
          <Slider
            value={Math.round(o.quality * 100)}
            min={10}
            max={100}
            onChange={(v) => set({ quality: v / 100 })}
            suffix="%"
          />
        </div>
      )}

      <div className="section">
        <h4 className="section-title">Estimate</h4>
        <div
          style={{
            padding: '12px 12px',
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 6,
          }}
        >
          <Row label="Resolution" value={`${outW} × ${outH}`} />
          <Row label="Format" value={o.format.toUpperCase()} />
          {o.format !== 'png' && <Row label="Quality" value={`${Math.round(o.quality * 100)}%`} />}
          <Row label="File size" value={`~${formatBytes(estimate)}`} accent />
          <Row label="Megapixels" value={`${((outW * outH) / 1_000_000).toFixed(1)} MP`} />
          {exportInfo.lastSize && (
            <Row
              label="Last export"
              value={`${formatBytes(exportInfo.lastSize)}${exportInfo.elapsedMs ? ` · ${exportInfo.elapsedMs}ms` : ''}${exportInfo.rendererName ? ` · ${exportInfo.rendererName}` : ''}`}
              muted
            />
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '10px 0 0', lineHeight: 1.55 }}>
          File size is approximate. Actual size depends on image entropy.
        </p>
      </div>
    </>
  );
}

function FolderRow() {
  const [handle, setHandle] = useState<DirHandleLike | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getStoredFolder().then(setHandle);
  }, []);

  if (!supportsFolderPicker) {
    return (
      <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0', lineHeight: 1.55 }}>
        Save dialog will appear on export. (Choose-folder requires Chrome/Edge.)
      </p>
    );
  }

  const onPick = async () => {
    setError(null);
    try {
      const h = await pickFolder();
      if (h) setHandle(h);
    } catch (e) {
      if (e instanceof FolderPickerError) {
        setError(e.message);
      } else {
        setError((e as Error).message);
      }
    }
  };
  const onClear = async () => {
    await clearFolder();
    setHandle(null);
    setError(null);
  };

  return (
    <>
      <div className="row-stack" style={{ marginTop: 6 }}>
        <label>Folder</label>
        {handle ? (
          <>
            <span
              className="field"
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={handle.name}
            >
              <FolderOpen size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {handle.name}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn ghost" style={{ height: 26, padding: '0 8px', flex: 1 }} onClick={onPick}>
                Change
              </button>
              <button
                className="btn ghost"
                style={{ height: 26, padding: '0 8px', color: 'var(--text-3)' }}
                onClick={onClear}
                title="Use save dialog instead"
              >
                ×
              </button>
            </div>
          </>
        ) : (
          <button className="btn" style={{ width: '100%' }} onClick={onPick}>
            <Folder size={14} /> Choose folder…
          </button>
        )}
      </div>
      {error && (
        <p style={{ fontSize: 11, color: 'var(--danger)', margin: '4px 0 8px', lineHeight: 1.55 }}>
          {error}
        </p>
      )}
      {!handle && !error && (
        <p style={{ fontSize: 11, color: 'var(--text-4)', margin: '4px 0 0', lineHeight: 1.55 }}>
          Tip: the browser blocks Desktop, root, and some system folders. ~/Pictures or any subfolder works.
        </p>
      )}
    </>
  );
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '5px 0',
        fontFamily: 'var(--mono)',
        fontSize: 11.5,
      }}
    >
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span
        style={{
          color: accent ? 'var(--accent)' : muted ? 'var(--text-3)' : 'var(--text)',
          fontWeight: accent ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}
