interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function ColorField({ value, onChange }: Props) {
  return (
    <label className="field" style={{ cursor: 'pointer' }}>
      <span
        className="inline-block w-[18px] h-[18px] rounded-[4px]"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(127,127,127,0.20)',
          backgroundColor: value,
        }}
      />
      <span className="font-mono text-[11.5px] flex-1 uppercase">{value}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
      />
    </label>
  );
}
