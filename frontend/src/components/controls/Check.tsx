interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}

export function Check({ checked, onChange, children }: Props) {
  return (
    <label className="flex items-center gap-2 cursor-pointer h-7 px-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="hidden"
      />
      <span
        className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-[3px]"
        style={{
          background: checked ? 'var(--accent)' : 'var(--panel)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--line-strong)'}`,
        }}
      >
        {checked && (
          <span
            style={{
              width: 7,
              height: 4,
              borderLeft: '1.5px solid var(--check-mark)',
              borderBottom: '1.5px solid var(--check-mark)',
              transform: 'rotate(-45deg) translateY(-1px)',
            }}
          />
        )}
      </span>
      <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{children}</span>
    </label>
  );
}
