export function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}

export function midpointOf(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    remaining -= seg;
  }
  return points[points.length - 1];
}
