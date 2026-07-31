import { BRANCH_ACCENT_PERCENT, branchInk, mixSrgb, resolveToken, tokenReader } from './tokens';

/** The palette as tokens.css states it, in the notation a stylesheet is written in. */
const ACCENT = '#A3E635';
const LINE = '#232A3B';
/** What color-mix(in srgb, var(--accent) 45%, var(--line)) resolves to. */
const BRANCH = 'rgb(93, 127, 56)';

function withTokens(values: Record<string, string>): () => void {
  for (const [name, value] of Object.entries(values)) {
    document.documentElement.style.setProperty(name, value);
  }
  return () => {
    for (const name of Object.keys(values)) document.documentElement.style.removeProperty(name);
  };
}

it('reads a token off the root and states nothing for one that is not there', () => {
  const restore = withTokens({ '--accent': ACCENT });
  try {
    const read = tokenReader();
    expect(read('--accent')).toBe(ACCENT);
    expect(read('--nothing-here')).toBeUndefined();
    expect(resolveToken(document.documentElement, '--accent')).toBe(ACCENT);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The mix, which is what makes a derived ink possible at all
// ---------------------------------------------------------------------------

it('mixes two hex colours the way color-mix in srgb does', () => {
  // 0.45×163 + 0.55×35 = 92.6 → 93, and so on down the channels
  expect(mixSrgb(ACCENT, LINE, BRANCH_ACCENT_PERCENT)).toBe(BRANCH);
});

it('reads the rgb() notation a browser answers computed styles in', () => {
  expect(mixSrgb('rgb(163, 230, 53)', 'rgb(35, 42, 59)', BRANCH_ACCENT_PERCENT)).toBe(BRANCH);
  // and the shorthand a stylesheet may be written in
  expect(mixSrgb('#fff', '#000', 50)).toBe('rgb(128, 128, 128)');
});

it('states nothing when either side is missing or is not a colour it can read', () => {
  expect(mixSrgb(undefined, LINE, 45)).toBeUndefined();
  expect(mixSrgb(ACCENT, undefined, 45)).toBeUndefined();
  expect(mixSrgb('var(--accent)', LINE, 45)).toBeUndefined();
  expect(mixSrgb(ACCENT, 'transparent', 45)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// The branch ink
// ---------------------------------------------------------------------------

// The point of deriving it: move --accent and the branch edge follows, instead of
// staying at a value worked out against a palette that has since changed.
it('derives the branch ink from the palette rather than from a frozen token', () => {
  const restore = withTokens({ '--accent': ACCENT, '--line': LINE, '--edge-branch': '#FF0000' });
  try {
    expect(branchInk(tokenReader())).toBe(BRANCH);
  } finally {
    restore();
  }
});

it('follows the accent when the palette moves', () => {
  const restore = withTokens({ '--accent': '#FF0000', '--line': '#000000' });
  try {
    // 0.45 × 255 = 114.75 → 115
    expect(branchInk(tokenReader())).toBe('rgb(115, 0, 0)');
  } finally {
    restore();
  }
});

// The token stays in tokens.css for exactly this: a browser that cannot resolve
// the two halves still has a branch colour, and the edge is never left with none.
it('falls back to the stated token when the mix cannot be worked out', () => {
  const restore = withTokens({ '--accent': ACCENT, '--edge-branch': BRANCH });
  try {
    expect(branchInk(tokenReader())).toBe(BRANCH);
  } finally {
    restore();
  }
});

it('states nothing at all when there is no palette to read', () => {
  expect(branchInk(tokenReader())).toBeUndefined();
});
