interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, suffix = '' }: Props) {
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
        value={`${value}${suffix}`}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </div>
  );
}
