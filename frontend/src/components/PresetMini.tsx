import type { LayoutPreset } from '@/types';

export function PresetMini({ preset }: { preset: LayoutPreset }) {
  return (
    <div
      className="mini"
      style={{
        gridTemplateColumns: `repeat(${preset.cols}, 1fr)`,
        gridTemplateRows: `repeat(${preset.rows}, 1fr)`,
      }}
    >
      {preset.cells.map((c, i) => (
        <i
          key={i}
          style={{
            gridColumn: `${c.c} / span ${c.cs ?? 1}`,
            gridRow: `${c.r} / span ${c.rs ?? 1}`,
          }}
        />
      ))}
    </div>
  );
}
