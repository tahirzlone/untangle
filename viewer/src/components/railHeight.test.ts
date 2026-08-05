import { readFileSync } from 'node:fs';

/**
 * The rail's height contract, read off the stylesheets themselves.
 *
 * jsdom lays nothing out and vitest does not even load the CSS, so no rendered
 * test in this suite can catch a rail that runs off the bottom of the canvas —
 * the bug this pins was found by measuring a real browser at 1280x700, where the
 * install kit sat 15px below the fold with nothing on the page able to scroll.
 * The browser is still where that is proved; what is pinned here is the shape of
 * the fix, so a later edit cannot quietly take the bound away and leave the
 * surface unreachable again with every test still green.
 *
 * Read as source rather than as computed style because that is the only thing
 * available: the assertions are about which declarations exist, and the browser
 * measurements in the task report are about what they do.
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
const prompt = css('prompt.css');
const kit = css('installKit.css');

// The column is absolutely positioned inside a canvas that clips: anything past
// the bottom is not merely off-screen, it is unreachable. A maximum bound is what
// makes the panels below it shrink instead of overflowing.
it('bounds the rail to the canvas under the toolbar', () => {
  const sgRail = rule(canvas, '.sg-rail');
  expect(sgRail).toMatch(/max-height:\s*calc\(100% - var\(--toolbar-h/);
  // and it is a MAXIMUM: a rail with room to spare is still sized by its children,
  // so the graph under the empty part of the column still takes a pointer
  expect(sgRail).not.toMatch(/(^|[\s;])height:/);
  expect(sgRail).not.toMatch(/bottom:/);
});

// One panel has to absorb the shortfall, and absorbing it is only survivable if
// what is squeezed out can be scrolled back to. The prompt panel is the one that
// holds both the prompt and the kit, so it is the one that gives.
it('makes the prompt panel the item that gives way, and lets it scroll', () => {
  const sgPrompt = rule(prompt, '.sg-prompt');
  expect(sgPrompt).toMatch(/min-height:\s*0/);
  expect(sgPrompt).toMatch(/overflow-y:\s*auto/);
});

// Shrinking a scroller is free, so without a floor the flex algorithm takes the
// prompt block down to a single line to make room for the kit's rows.
it('keeps a floor under the prompt block', () => {
  expect(rule(prompt, '.sg-prompt-text')).toMatch(/min-height:\s*\d+px/);
});

// One scroller in the panel, not two: the kit is a list of rows with a height of
// its own, and a list that scrolled inside a panel that scrolls would be two
// answers to one gesture.
it('gives the kit list no scroller of its own', () => {
  const list = rule(kit, '.sg-kit-list');
  expect(list).not.toMatch(/max-height:/);
  expect(list).not.toMatch(/overflow/);
});
