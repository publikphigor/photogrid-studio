import { useState } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}

/** Slider + numeric input. The numeric field uses a buffered-edit pattern so
 *  the user can backspace to clear the field and type a fresh value without
 *  the controlled-input snapping back to the current state on every keystroke.
 *  The new value is committed on Enter or blur; Escape cancels. */
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
  // Avoid showing trailing decimals for integer-step sliders, but keep them
  // for fractional steps (e.g. zoom 0.05).
  if (Number.isInteger(v)) return String(v);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0';
}
