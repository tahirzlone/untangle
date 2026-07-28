import { midpointOf, pointsToPath } from './path';

it('builds an SVG path visiting every point', () => {
  const d = pointsToPath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }]);
  expect(d).toBe('M 0 0 L 0 40 L 80 40');
});

it('returns empty string for fewer than two points', () => {
  expect(pointsToPath([])).toBe('');
  expect(pointsToPath([{ x: 1, y: 1 }])).toBe('');
});

it('finds the true midpoint of a two-point edge', () => {
  expect(midpointOf([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual({ x: 0, y: 50 });
});

it('finds the midpoint along a multi-segment polyline', () => {
  expect(
    midpointOf([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 80 }]),
  ).toEqual({ x: 40, y: 40 });
});
