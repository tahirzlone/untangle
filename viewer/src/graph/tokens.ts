/**
 * The theme, read at runtime.
 *
 * Every colour and rhythm this app draws with lives in `tokens.css`. Code that
 * needs one of them asks for it here rather than repeating the value: a literal
 * in TypeScript is a second source of truth that goes stale the moment the
 * palette moves, and the whole point of the tokens is that it cannot.
 */

/**
 * A reader for one element's resolved custom properties.
 *
 * The declaration is taken once and read many times — `getComputedStyle` returns
 * a LIVE object, so a component resolving half a dozen tokens per render pays for
 * one lookup rather than six.
 */
export function tokenReader(el: Element = document.documentElement) {
  const styles = getComputedStyle(el);
  // Empty means unresolved — no stylesheet loaded (jsdom) or no such token —
  // and undefined is how a caller declines to state it rather than stating "".
  return (name: string): string | undefined => styles.getPropertyValue(name).trim() || undefined;
}

/**
 * One token, as it resolves for an element.
 *
 * The element first, because that is where a browser answers with the inherited
 * value; the document root second, because jsdom implements no custom-property
 * inheritance and a caller reading off a child would otherwise get nothing at all.
 */
export function resolveToken(el: Element, name: string): string | undefined {
  return tokenReader(el)(name) ?? tokenReader(document.documentElement)(name);
}

/**
 * How much `--accent` is in the branch edge's ink; the rest is `--line`.
 *
 * The number is the one `color-mix(in srgb, var(--accent) 45%, var(--line))` was
 * written with when the branch edge was designed: enough accent to read as part
 * of the same graph, quiet enough that a conditional route does not compete with
 * the run it hangs off.
 */
export const BRANCH_ACCENT_PERCENT = 45;

/** One colour as three 0–255 channels, or nothing when it is not one this reads. */
function channels(color: string | undefined): [number, number, number] | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1].replace(/./g, (d) => d + d)
        : hex[1];
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }
  // what getComputedStyle answers in, whatever the stylesheet was written in
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

/**
 * Two colours mixed the way `color-mix(in srgb, a P%, b)` mixes them.
 *
 * Opaque sRGB only, which is all this palette is: every token in tokens.css that
 * takes part in a mix is a solid hex. A colour with alpha, a keyword, or an
 * unresolved `var()` states nothing rather than being guessed at — the caller
 * then falls back to a token that was worked out by a browser, not by this.
 */
export function mixSrgb(
  a: string | undefined,
  b: string | undefined,
  percentA: number,
): string | undefined {
  const from = channels(a);
  const to = channels(b);
  if (!from || !to) return undefined;
  const p = percentA / 100;
  const mixed = from.map((c, i) => Math.round(c * p + to[i] * (1 - p)));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/**
 * The ink a branch edge draws in, worked out from the palette at the moment it is
 * asked for.
 *
 * The edge has to state this colour as a PRESENTATION ATTRIBUTE — an exported PNG
 * is a clone of the DOM with no stylesheet behind it, so an attribute has to carry
 * a value that resolves with no custom properties in scope. That used to mean
 * `--edge-branch` was the mix worked out by hand once and frozen, which is a
 * second source of truth: move `--accent` and the branch edges keep drawing
 * against the palette that used to be there.
 *
 * So the mix is done here instead, from the two tokens it is a mix OF.
 * `--edge-branch` stays in tokens.css as the fallback for a reader that cannot
 * resolve them — a browser between stylesheets, or a test that installed half a
 * palette — so an edge is never left with no colour at all.
 */
export function branchInk(read: (name: string) => string | undefined): string | undefined {
  return mixSrgb(read('--accent'), read('--line'), BRANCH_ACCENT_PERCENT) ?? read('--edge-branch');
}
