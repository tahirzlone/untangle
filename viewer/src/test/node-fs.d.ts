/**
 * The one node API the suite touches, declared rather than depended on.
 *
 * `railHeight.test.ts` reads two stylesheets as text, because vitest stubs every
 * CSS import to an empty string (`test.css` is off) — `?raw` included — and jsdom
 * lays nothing out, so there is no computed style to ask and no box to measure.
 *
 * Declared here instead of adding `@types/node` and putting "node" in the
 * tsconfig's `types`: the viewer ships to a browser, and a tsconfig that offered
 * the whole node API to every file would be saying otherwise for the sake of one
 * test reading one file.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
