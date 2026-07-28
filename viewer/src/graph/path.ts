export function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}

export function labelAnchor(points: { x: number; y: number }[]): { x: number; y: number; vertical: boolean } {
  if (points.length === 0) return { x: 0, y: 0, vertical: false };
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const seg = Math.abs(dx) + Math.abs(dy);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return {
        x: points[i - 1].x + dx * t,
        y: points[i - 1].y + dy * t,
        vertical: Math.abs(dy) >= Math.abs(dx),
      };
    }
    remaining -= seg;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, vertical: false };
}

export function wrapLabel(label: string, maxChars = 24): string[] {
  const words = label.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function midpointOf(points: { x: number; y: number }[]): { x: number; y: number } {
  const { x, y } = labelAnchor(points);
  return { x, y };
}
