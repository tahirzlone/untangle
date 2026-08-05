import { useMemo, useState } from 'react';
import { buildInstallBlock, hasInstall, installKind } from '../graph/installKit';
import type { Suggestion } from '../graph/types';
import { CopyButton } from './CopyButton';
import './installKit.css';

/**
 * One row of the kit: a resource the prompt is about to rely on, and the command
 * that puts it on the machine.
 *
 * The command is SHOWN, not summarized. Consent here is per-string — the install
 * text comes out of a remote knowledge base and is reproduced verbatim into
 * something the user will paste into a shell — so the string on screen is the
 * thing the box is ticking, and the box is described by it: a screen reader
 * hearing "firecrawl-mcp, ticked" and nothing else would be hearing a name
 * consent to a command.
 *
 * A row with no command to run is still a row. The KB has resources whose install
 * is a page to read, and hiding them would leave the prompt naming a dependency
 * the kit never mentioned; instead the box is cleared and disabled, and the line
 * under it is a real link to the page — the explanation for the dead control sits
 * one Tab away from it, which is the whole reason a native `disabled` is fair
 * here where the drawer's APPLY needed `aria-disabled`.
 */
function KitRow({
  suggestion,
  checked,
  onToggle,
}: {
  suggestion: Suggestion;
  checked: boolean;
  onToggle: () => void;
}) {
  // The trim gate FIRST, the kind after it: `installKind('')` answers 'shell',
  // which is a real answer to the wrong question. A row whose install field holds
  // nothing but spaces is a link-only row, however runnable an empty string looks.
  const command = hasInstall(suggestion) ? suggestion.install : null;
  const id = `sg-kit-${suggestion.airtableRecordId}`;
  const noteId = `${id}-note`;

  return (
    <li
      className={`sg-kit-row${command === null ? ' sg-kit-row--manual' : ''}`}
      data-testid="kit-row"
    >
      <div className="sg-kit-line">
        <input
          className="sg-kit-check"
          type="checkbox"
          id={id}
          data-testid="kit-check"
          checked={checked}
          disabled={command === null}
          // the command, or the reason there is none — either way, what the box
          // is actually about
          aria-describedby={noteId}
          onChange={onToggle}
        />
        <label className="sg-kit-name" htmlFor={id}>
          {suggestion.name}
        </label>
        {/* No shell runs `/plugin install`, so a kit that offered it as a command
            would be offering a paste that fails. The badge says where it goes
            before the block says it in a comment. */}
        {command !== null && installKind(command) === 'slash' ? (
          <span className="sg-kit-badge" data-testid="kit-badge">
            TYPED INSIDE CLAUDE CODE
          </span>
        ) : null}
      </div>
      {command === null ? (
        // opened away from the graph, and noreferrer with noopener so the new tab
        // gets no handle on this one — the same terms the drawer's links are on
        <a
          className="sg-kit-manual"
          id={noteId}
          data-testid="kit-manual"
          href={suggestion.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          no install command — follow its page
        </a>
      ) : (
        // user-select: all in the stylesheet — one click takes the whole command
        <code className="sg-kit-cmd" id={noteId} data-testid="kit-cmd">
          {command}
        </code>
      )}
    </li>
  );
}

/**
 * The rows as the kit lists them: one per COMMAND, plus every row that has none.
 *
 * The same MCP server suggested at two steps is one `claude mcp add`, and the
 * block has always said so — so the surface says it too, rather than drawing two
 * boxes over one line and leaving one of them looking broken when it is cleared
 * and the command stays. One tick, one line, both ways round.
 *
 * A row with no command is never folded into another: there is nothing to install
 * twice, and each is a different page to go and read.
 */
function listedRows(rows: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return rows.filter((s) => {
    if (!hasInstall(s)) return true;
    if (seen.has(s.install)) return false;
    seen.add(s.install);
    return true;
  });
}

/**
 * The install kit: the applied resources as commands, ticked or cleared.
 *
 * The prompt above it NAMES every install; naming is not installing. A skill that
 * is not on the machine does nothing when the pasted prompt asks for it, and an
 * MCP server added halfway through a session is not there until the next one — so
 * the commands are offered here, before the prompt, as one block to paste.
 *
 * Rows arrive in flow order, the same order the prompt introduces them in, and
 * they stay in it: a reader checking the kit against the prompt is reading two
 * lists in one order. The BLOCK reorders — shell first, Claude Code's commented
 * second — because that is what makes it paste-runnable, and the block says which
 * is which where it does it.
 *
 * Every runnable row starts ticked, because the answer to "install all of them"
 * is usually yes and the alternative is a control surface that starts refusing.
 * Clearing them all leaves nothing to hand over, and COPY stands down rather than
 * flashing COPIED over an empty string.
 *
 * State is per version, and that is enforced from outside: the host keys this
 * component on the cursor, so a version move remounts it and the ticks start
 * again from the row set that version actually has. A tick is consent to install
 * a particular command, and consent given about one set of steps must not be
 * inherited by another.
 */
export function InstallKit({ rows }: { rows: Suggestion[] }) {
  /**
   * The rows the user has taken OUT, rather than the ones left in.
   *
   * Default-ticked is then structural: a row is in the kit until it is cleared,
   * so nothing depends on an initializer having seen the row when it mounted.
   */
  const [cleared, setCleared] = useState<ReadonlySet<string>>(() => new Set());

  const listed = useMemo(() => listedRows(rows), [rows]);
  const selected = useMemo(
    () => listed.filter((s) => hasInstall(s) && !cleared.has(s.airtableRecordId)),
    [listed, cleared],
  );
  const block = useMemo(() => buildInstallBlock(selected), [selected]);

  const toggle = (airtableRecordId: string) =>
    setCleared((prev) => {
      const next = new Set(prev);
      if (!next.delete(airtableRecordId)) next.add(airtableRecordId);
      return next;
    });

  return (
    <section className="sg-kit" data-testid="install-kit" aria-labelledby="sg-kit-title">
      <div className="sg-kit-head">
        <h3 className="sg-kit-title" id="sg-kit-title">
          INSTALL KIT
        </h3>
        {/* Nothing to offer is not something to offer badly: with no rows at all
            there is no block, and a disabled COPY beside an empty list would be a
            control standing in for a sentence. */}
        {listed.length > 0 ? (
          <CopyButton text={block} testId="kit-copy" disabled={block === ''} />
        ) : null}
      </div>
      {listed.length === 0 ? (
        <p className="sg-kit-none" data-testid="kit-none">
          NOTHING TO INSTALL
        </p>
      ) : (
        <ul className="sg-kit-list" data-testid="kit-list">
          {listed.map((s) => (
            <KitRow
              key={s.airtableRecordId}
              suggestion={s}
              // A link-only row is never ticked: there is no command for a tick to
              // put in the block, and a box that stayed ticked over nothing would
              // be counting it in.
              checked={hasInstall(s) && !cleared.has(s.airtableRecordId)}
              onToggle={() => toggle(s.airtableRecordId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
