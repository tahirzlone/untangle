import type { Suggestion } from './types';

/**
 * The install kit: what the prompt is about to rely on, as commands to run.
 *
 * The optimized prompt already NAMES every install — gathered into the setup
 * block prompt.ts writes under the prose. Naming is not installing. A skill
 * that is not on the machine does nothing when the pasted prompt asks for it,
 * and an MCP server added halfway through a session is not there until the
 * next one, so the commands belong BEFORE the prompt rather than inside it.
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
 *
 * THE LINE-BREAK RULE: an install string carrying a line break — measured on the
 * trimmed string, so the whitespace around a one-line command does not count — is
 * never handed over as a command, whichever half it would otherwise fall in.
 * Every one of its physical lines is commented, under a header saying the kit is
 * not offering it. Class makes no difference to that: line 2 of a "shell" install
 * is as unvetted as line 2 of a slash one, the row above showed one command, and
 * a paste would run two. These strings come out of a remote knowledge base, so
 * the question is not whether a generation would write such a thing but what this
 * module does when one arrives — and what it does is stop short of the shell.
 */

/** The block's own first line, so a kit found in a terminal says what it is. */
const HEADER = '# Untangle install kit';

/** The line every Claude Code command stands under. */
const SLASH_HEADER = '# inside Claude Code, type:';

/** The line a string demoted by the line-break rule stands under. */
const MULTILINE_HEADER = '# more than one line — read it, then run it yourself:';

/** The indent a commented command takes, under either header. */
const COMMENT_PREFIX = '#   ';

/** Every way a string can carry a second physical line into a pasted block. */
const LINE_BREAK = /\r\n|[\r\n]/;

/**
 * A string as the lines it would occupy in the block, each one commented — so
 * nothing in it is left for a shell to read as a command of its own.
 */
const commented = (install: string): string[] =>
  install.split(LINE_BREAK).map((line) => `${COMMENT_PREFIX}${line}`);

/** Which half of the block an install string belongs in. */
export type InstallKind = 'shell' | 'slash';

/** A row the kit can hand over as a COMMAND: its install field holds one. */
export type Installable = Suggestion & { install: string };

/**
 * Whether a row is something to run at all, or a page to go and read.
 *
 * The schema puts no floor under `install`, so a generation can hand over a field
 * with nothing but spaces in it. Exported rather than restated at every caller
 * because the block and the surface that lists it have to agree about that row
 * down to the character: a component asking `!!s.install` would draw a ticked,
 * runnable-looking row whose command never reaches the block — the copy quietly
 * breaking a promise the checkbox made. One predicate, so the two cannot part.
 *
 * A type predicate, so asking the question hands back a row whose install is a
 * string — and `installKind` is only meaningful on one of those. An empty string
 * starts with no slash and would classify as `'shell'`, which is a real answer to
 * the wrong question: the gate comes first, the kind after it.
 */
export function hasInstall(s: Suggestion): s is Installable {
  return !!s.install?.trim();
}

/**
 * Where an install string is typed, read off the string and not off the row's
 * category. The category says what the resource IS — a Claude Skill, an MCP
 * server — and this is a question about how it is run: skills arrive as
 * `/plugin install`, MCP servers as a shell command, and the KB is free to pair
 * them the other way round. A leading slash is the one mark that means "inside
 * Claude Code"; everything else is something a shell can execute.
 *
 * Read off the TRIMMED string, because leading space is not a class: a KB row
 * holding `'  /plugin install x'` names the same interface command as one without
 * the space, and reading it raw would send it out bare into a shell that has no
 * such command — while the skill's own setup stage, which never runs a string it
 * cannot classify, would print it. One string, two answers, is one too many.
 */
export function installKind(install: string): InstallKind {
  return install.trim().startsWith('/') ? 'slash' : 'shell';
}

/**
 * Does THE LINE-BREAK RULE demote this string out of both halves of the block?
 *
 * Exported for the same reason `hasInstall` is: the surface listing these rows
 * has to agree with the block down to the character. `installKind` is blind to
 * line breaks — it reads the first character of the trimmed string and nothing
 * else — so a multi-line string starting with a slash classifies as 'slash' and
 * the row badged it as something to type inside Claude Code, while the block was
 * demoting it wholesale to the section that says the kit is not offering it. One
 * string, two answers, is one too many; this is the question the badge has to ask
 * first.
 *
 * Measured on the trimmed string, like every other rule here: the whitespace
 * around a one-line command is not a second line.
 */
export function isMultiLine(install: string): boolean {
  return LINE_BREAK.test(install.trim());
}

/**
 * The kit for a selection, as one block — or nothing at all.
 *
 * Shell lines first and bare, so a paste ACTS: a selection of nothing but MCP
 * servers comes out as commands with no prose to step over. The Claude Code
 * section follows, and only when something is in it — a heading with no list
 * under it is the template showing through, the same bargain prompt.ts's setup
 * block strikes. Within each class the order is the order the caller gave, which
 * is flow order when the caller is reading off `appliedInFlowOrder`.
 *
 * A suggestion with no install is SKIPPED here rather than refused: the KB has
 * rows whose install is a page to read, and the caller shows those as links.
 * Skipping is what lets a whole applied set be handed over unfiltered. A
 * duplicate string appears once — the exact-string rule prompt.ts dedupes
 * installs by — because the same MCP suggested at two steps is one `mcp add`.
 *
 * A string the line-break rule demotes goes last, in a section of its own: the
 * two sections above it are things to do, and this one is a thing to read, so it
 * stands after them rather than between a paste and what it was going to run.
 *
 * Empty selection, or one naming no command at all: `''`, not a lone header.
 * The trailing newline is there so the last command arrives as a whole line
 * rather than as something the shell is still waiting on.
 */
export function buildInstallBlock(selected: Suggestion[]): string {
  const seen = new Set<string>();
  const shell: string[] = [];
  const slash: string[] = [];
  const demoted: string[] = [];

  for (const s of selected) {
    // Nothing to run is not something to list: an install with no command in it
    // would paste as a blank line the user is invited to trust. The same gate the
    // rows on screen are drawn through, so a row that looks runnable is one.
    if (!hasInstall(s)) continue;
    const install = s.install;
    if (seen.has(install)) continue;
    seen.add(install);
    // The line-break rule first, and it answers for both classes: a break inside
    // the command is a second line the paste would carry, and neither section
    // above can represent the pair as the one command the row consented to.
    if (isMultiLine(install)) demoted.push(install);
    else if (installKind(install) === 'slash') slash.push(install);
    else shell.push(install);
  }

  if (shell.length === 0 && slash.length === 0 && demoted.length === 0) return '';

  const lines = [HEADER, ...shell];
  if (slash.length > 0) lines.push(SLASH_HEADER, ...slash.flatMap(commented));
  if (demoted.length > 0) lines.push(MULTILINE_HEADER, ...demoted.flatMap(commented));
  return `${lines.join('\n')}\n`;
}
