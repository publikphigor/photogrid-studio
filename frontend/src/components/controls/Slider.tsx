import { useState } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}

// Buffered numeric edit so backspace-to-clear doesn't snap back; commit on Enter/blur.
export function Slider({ value, min = 0, max = 100, step = 1, onChange, suffix = '' }: Props) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const display = editing ? raw : `${formatValue(value)}${suffix}`;

  const commit = () => {
    const trimmed = raw.trim().replace(/[^0-9.\-]/g, '');
    if (trimmed.length > 0) {
      const n = parseFloat(trimmed);
      if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
    }
    setEditing(false);
  };

  return (
    <div className="slider-wrap">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        className="num-input"
        value={display}
        onFocus={(e) => {
          setEditing(true);
          setRaw(`${formatValue(value)}`);
          e.currentTarget.select();
        }}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0';
}
