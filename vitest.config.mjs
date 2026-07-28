import { defineConfig } from 'vitest/config';

// The root suite covers the Phase-1 contract (schema + CLI) only.
// The viewer is a separate npm package with its own jsdom-based vitest run
// (`npm --prefix viewer test`); without this scoping, root `vitest run` would
// also collect viewer/src/**/*.test.tsx and fail for lack of a DOM environment.
export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
});
