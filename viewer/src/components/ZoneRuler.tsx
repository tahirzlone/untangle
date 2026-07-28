export function ZoneRuler({ axis, count }: { axis: 'top' | 'side'; count: number }) {
  const cells = Array.from({ length: count }, (_, i) =>
    axis === 'top' ? String(i + 1) : String.fromCharCode(65 + i),
  );
  return (
    <div className={`bp-zones bp-zones--${axis}`} data-testid={`zone-ruler-${axis}`}>
      {cells.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}
