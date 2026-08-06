import { readFileSync } from 'node:fs';

/**
 * The rail's height contract, read off the stylesheets themselves.
 *
 * jsdom lays nothing out and vitest does not even load the CSS, so no rendered
 * test in this suite can catch a rail that runs off the bottom of the canvas —
 * the bug this pins was found by measuring a real browser at 1280x700, where
 * the rail's content sat below the fold with nothing on the page able to
 * scroll. The browser is still where that is proved; what is pinned here is
 * the shape of the fix, so a later edit cannot quietly take the bound away and
 * leave the surface unreachable again with every test still green.
 *
 * The rail holds the impact panel alone since the Results Window absorbed the
 * prompt and the kit, so the contract is two rules: the column is bounded, and
 * the panel inside it scrolls its own body rather than being cut off.
 *
 * Read as source rather than as computed style because that is the only thing
 * available: the assertions are about which declarations exist, and the browser
 * measurements in the task reports are about what they do.
 */

/** A stylesheet as text. Relative, because the suite runs from `viewer/`. */
const css = (name: string) => readFileSync(`src/components/${name}`, 'utf8');

/** The declarations inside one top-level rule, with comments stripped. */
function rule(sheet: string, selector: string): string {
  const at = sheet.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const open = sheet.indexOf('{', at);
  const close = sheet.indexOf('}', open);
  return sheet.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

const canvas = css('canvas.css');
const impact = css('impact.css');

// The column is absolutely positioned inside a canvas that clips: anything past
// the bottom is not merely off-screen, it is unreachable. A maximum bound is what
// makes the panel below it shrink instead of overflowing.
it('bounds the rail to the canvas under the toolbar', () => {
  const sgRail = rule(canvas, '.sg-rail');
  expect(sgRail).toMatch(/max-height:\s*calc\(100% - var\(--toolbar-h/);
  // and it is a MAXIMUM: a rail with room to spare is still sized by its children,
  // so the graph under the empty part of the column still takes a pointer
  expect(sgRail).not.toMatch(/(^|[\s;])height:/);
  expect(sgRail).not.toMatch(/bottom:/);
});

// Absorbing a squeeze is only survivable if what is squeezed out can be
// scrolled back to: the panel's body is the scroller, so a session with a long
// history still fits under the bound above.
it('lets the impact panel scroll its own body instead of losing it', () => {
  const body = rule(impact, '.sg-impact-body');
  expect(body).toMatch(/max-height:/);
  expect(body).toMatch(/overflow-y:\s*auto/);
});
