interface Option<T> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}

export function Seg<T extends string | number>({ options, value, onChange }: Props<T>) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
