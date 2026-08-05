import type { Suggestion } from './types';

/**
 * The install kit: what the prompt is about to rely on, as commands to run.
 *
 * The optimized prompt already NAMES every install — quoted inside an authored
 * fragment, templated into a fallback line, or gathered into the closing line
 * prompt.ts writes. Naming is not installing. A skill that is not on the machine
 * does nothing when the pasted prompt asks for it, and an MCP server added
 * halfway through a session is not there until the next one, so the commands
 * belong BEFORE the prompt rather than inside it.
 *
 * They come out of here as one block to paste, in two classes, because they are
 * typed in two different places: `claude mcp add …` is a shell command and goes
 * in bare, while `/plugin install …` is typed inside Claude Code and no shell
 * can run it — so it goes in commented, under a line saying where it IS typed.
 * `#` opens a comment in PowerShell and in bash alike, which is the whole reason
 * one block can be pasted into either without asking which one is open.
 *
 * Pure, and it writes only what it is handed: the caller decides what is in the
 * kit. Install strings are reproduced verbatim — never edited, never invented —
 * because the string is the thing the user is consenting to run, and a command
 * this module improved would be a command nobody approved.
 */

/** The block's own first line, so a kit found in a terminal says what it is. */
const HEADER = '# Flowprint install kit';

/** The line every Claude Code command stands under, and the indent under it. */
const SLASH_HEADER = '# inside Claude Code, type:';
const SLASH_PREFIX = '#   ';

/** Which half of the block an install string belongs in. */
export type InstallKind = 'shell' | 'slash';

/**
 * Where an install string is typed, read off the string and not off the row's
 * category. The category says what the resource IS — a Claude Skill, an MCP
 * server — and this is a question about how it is run: skills arrive as
 * `/plugin install`, MCP servers as a shell command, and the KB is free to pair
 * them the other way round. A leading slash is the one mark that means "inside
 * Claude Code"; everything else is something a shell can execute.
 */
export function installKind(install: string): InstallKind {
  return install.startsWith('/') ? 'slash' : 'shell';
}

/**
 * The kit for a selection, as one block — or nothing at all.
 *
 * Shell lines first and bare, so a paste ACTS: a selection of nothing but MCP
 * servers comes out as commands with no prose to step over. The Claude Code
 * section follows, and only when something is in it — a heading with no list
 * under it is the template showing through, the same bargain prompt.ts's closing
 * line strikes. Within each class the order is the order the caller gave, which
 * is flow order when the caller is reading off `appliedInFlowOrder`.
 *
 * A suggestion with no install is SKIPPED here rather than refused: the KB has
 * rows whose install is a page to read, and the caller shows those as links.
 * Skipping is what lets a whole applied set be handed over unfiltered. A
 * duplicate string appears once — the exact-string rule prompt.ts dedupes
 * installs by — because the same MCP suggested at two steps is one `mcp add`.
 *
 * Empty selection, or one naming no command at all: `''`, not a lone header.
 * The trailing newline is there so the last command arrives as a whole line
 * rather than as something the shell is still waiting on.
 */
export function buildInstallBlock(selected: Suggestion[]): string {
  const seen = new Set<string>();
  const shell: string[] = [];
  const slash: string[] = [];

  for (const s of selected) {
    const install = s.install;
    // Nothing to run is not something to list: an install with no command in it
    // would paste as a blank line the user is invited to trust.
    if (!install?.trim() || seen.has(install)) continue;
    seen.add(install);
    (installKind(install) === 'slash' ? slash : shell).push(install);
  }

  if (shell.length === 0 && slash.length === 0) return '';

  const lines = [HEADER, ...shell];
  if (slash.length > 0) lines.push(SLASH_HEADER, ...slash.map((s) => `${SLASH_PREFIX}${s}`));
  return `${lines.join('\n')}\n`;
}
