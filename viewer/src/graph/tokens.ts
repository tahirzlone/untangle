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
