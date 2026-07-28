export function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}
