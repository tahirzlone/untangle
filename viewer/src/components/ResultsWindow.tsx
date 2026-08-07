import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { GraphSession } from '../graph/apply';
import { buildInstallBlock, hasInstall, installKind, isMultiLine } from '../graph/installKit';
import { impactLabel, impactParts, impactSummary, painLabel } from '../graph/metrics';
import { appliedInFlowOrder, assemblePrompt } from '../graph/prompt';
import type { Suggestion } from '../graph/types';
import { CopyButton } from './CopyButton';
import { CategoryChip } from './DetailDrawer';
import './resultsWindow.css';

/**
 * The Results Window: the session's deliverable as one live control surface.
 *
 * Where the scorecard was a frozen report on a finished run, this window is a
 * VIEW of the session — everything on it is derived from `session` and
 * `excludeInstalls` on every render, so what it states is always what the graph
 * on screen has actually earned. It can afford to be live because the canvas
 * behind it is inert for as long as it is open: nothing can move the cursor out
 * from under a page the user is reading.
 *
 * Three sections. The SUMMARY states what changed — the same figures the impact
 * panel keeps, read through the same `impactSummary`, so the two can never
 * disagree. The RESOURCES are the applied rows as includable installs: each row
 * carries the command verbatim and a checkbox whose tick means "this command is
 * in the prompt below and in the kit" — nothing more. The label is deliberately
 * neutral: the window has no idea what is on the user's machine, so it claims
 * nothing about it. The PROMPT AREA holds the task as the user wrote it beside
 * the prompt the session assembled from it, each with its own copy — the
 * before/after the whole optimization story has been building toward.
 *
 * Modal in the way the scorecard was modal: the caller puts `inert` on the
 * canvas, and Tab is kept in here rather than left to geometry — the masthead
 * sits above the backdrop.
 */

/** Everything the browser will stop on inside the window, in tab order. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The one neutral thing a tick claims: the command joins the prompt and the kit. */
const INCLUDE_LABEL = 'include install steps';

/**
 * Is this end of a gesture one the backdrop may close on? The left button of the
 * primary pointer, and nothing else. A right-click raises the browser's own menu
 * over the backdrop and a middle-click pastes on X11 — neither asks for the
 * window to go, and both dispatch the same pointer pair a close is read off.
 * `isPrimary` says the same thing to a second finger arriving mid-pinch.
 */
const closes = (e: PointerEvent<HTMLDivElement>) => e.button === 0 && e.isPrimary;

/**
 * One row of the resources list: every applied suggestion it speaks for, and
 * the command they share.
 *
 * Rows sharing an identical install string collapse into ONE row naming all of
 * them — the same MCP suggested at two steps is one `mcp add`, and two boxes
 * over one line would leave one of them looking broken when it was cleared and
 * the line stayed. A row with no command is never folded into another: there is
 * nothing to install twice, and each is a different page to go and read.
 */
interface ResourceRow {
  /** The applied suggestions behind this row, in flow order. */
  members: Suggestion[];
  /** The command they share, or null for a link-only row. */
  command: string | null;
}

function rowsOf(applied: Suggestion[]): ResourceRow[] {
  const rows: ResourceRow[] = [];
  const byCommand = new Map<string, ResourceRow>();
  for (const s of applied) {
    if (!hasInstall(s)) {
      rows.push({ members: [s], command: null });
      continue;
    }
    const shared = byCommand.get(s.install);
    if (shared) {
      shared.members.push(s);
      continue;
    }
    const row: ResourceRow = { members: [s], command: s.install };
    byCommand.set(s.install, row);
    rows.push(row);
  }
  return rows;
}

/**
 * One resource row: name(s), category chip per member, the command verbatim (or
 * the page to follow), and the include checkbox.
 *
 * The command is SHOWN, not summarized — the tick is consent to a string headed
 * for the user's shell, so the string on screen is the thing being ticked, and
 * the box is described by it. A multi-line command renders every one of its
 * lines (pre-wrap in the stylesheet): collapsed to a space it would draw one
 * innocuous command over a string the kit carries as two, and the tick would be
 * consenting to a line the row never showed. No badge on those rows — the kit
 * demotes them to its commented section, so TYPED INSIDE CLAUDE CODE would
 * point at a place the command is not going, and the setup block skips them for
 * the same reason (see graph/prompt.ts).
 *
 * A shared-string row's one checkbox answers for the one line: its tick is
 * "is this command in play at all", so it reads checked while any member is
 * still included, and the toggle moves every member together.
 */
function ResourceRowItem({
  row,
  checked,
  onToggle,
}: {
  row: ResourceRow;
  checked: boolean;
  onToggle: (memberIds: string[], include: boolean) => void;
}) {
  const { command } = row;
  const names = row.members.map((m) => m.name).join(' + ');
  const id = `sg-results-${row.members[0].airtableRecordId}`;
  const noteId = `${id}-note`;

  return (
    <li
      className={`sg-results-row${command === null ? ' sg-results-row--manual' : ''}`}
      data-testid="results-row"
    >
      <div className="sg-results-row-head">
        {row.members.map((m) => (
          <CategoryChip category={m.category} key={m.airtableRecordId} />
        ))}
        <span className="sg-results-name" data-testid="results-name">
          {names}
        </span>
        {/* No shell runs `/plugin install` — the badge says where the command
            goes before the kit says it in a comment. The line-break rule is
            asked first, because it outranks the class: see the note above. */}
        {command !== null && !isMultiLine(command) && installKind(command) === 'slash' ? (
          <span className="sg-results-badge" data-testid="results-badge">
            TYPED INSIDE CLAUDE CODE
          </span>
        ) : null}
      </div>
      {command === null ? (
        // opened away from the graph, and noreferrer with noopener so the new
        // tab gets no handle on this one — the same terms the drawer's links are on
        <a
          className="sg-results-manual"
          id={noteId}
          data-testid="results-manual"
          href={row.members[0].url}
          target="_blank"
          rel="noopener noreferrer"
        >
          no install command — follow its page
        </a>
      ) : (
        <code className="sg-results-cmd" id={noteId} data-testid="results-cmd">
          {command}
        </code>
      )}
      <div className="sg-results-include">
        <input
          className="sg-results-check"
          type="checkbox"
          id={id}
          data-testid="results-check"
          checked={checked}
          // A link-only row has no install steps to include, so the control
          // stands down; the explanation is the link one Tab away from it.
          disabled={command === null}
          // The neutral label, kept distinguishable: several rows say "include
          // install steps", so the accessible name carries the resource too —
          // and the visible words open it, so label-in-name holds.
          aria-label={`${INCLUDE_LABEL} — ${names}`}
          // the command, or the reason there is none — what the box is actually about
          aria-describedby={noteId}
          onChange={() =>
            onToggle(
              row.members.map((m) => m.airtableRecordId),
              !checked,
            )
          }
        />
        <label className="sg-results-include-label" htmlFor={id}>
          {INCLUDE_LABEL}
        </label>
      </div>
    </li>
  );
}

export function ResultsWindow({
  session,
  excludeInstalls,
  onToggleInstalls,
  onClose,
}: {
  session: GraphSession;
  /** Applied resources whose install the prompt and the kit leave out. */
  excludeInstalls: ReadonlySet<string>;
  /** Moves a row's members in or out together — the caller owns the set. */
  onToggleInstalls: (memberIds: string[], include: boolean) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /**
   * Did the press start on the backdrop ITSELF? A drag that selects text in a
   * pane and overshoots the window's edge releases on the backdrop, and the
   * browser then dispatches the click on the two targets' common ancestor —
   * the backdrop — so a bare `onClick={onClose}` there threw away the window
   * AND the selection over a ~35px overshoot, on the one surface whose whole
   * point is text to take. Closing is therefore decided on the pointer events,
   * and only when the press and the release BOTH originated on the backdrop:
   * a gesture that touched the window at either end is the window's gesture,
   * not the way out.
   */
  const pressOnBackdrop = useRef(false);

  // Focus arrives with the window, whichever entry opened it — same bargain the
  // scorecard struck: landing focus here is what hands it back on the way out.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Tab wraps inside the window. `inert` on the canvas puts everything under
   * the backdrop out of reach, but the masthead lives above it and would
   * otherwise be one Tab away.
   */
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const stops = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return;
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    const wrap = e.shiftKey ? stops[stops.length - 1] : stops[0];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    wrap.focus();
  }, []);

  // Everything below is a pure function of the session and the exclusions,
  // memoized on exactly those: an apply, an undo, a version jump or a toggle
  // replaces one of the two, and every figure moves with it. No cache to go stale.
  const applied = useMemo(() => appliedInFlowOrder(session), [session]);
  const summary = useMemo(() => impactSummary(session), [session]);
  const rows = useMemo(() => rowsOf(applied), [applied]);

  /**
   * The AFTER pane, assembled live: exactly the excluded rows' commands drop
   * out, and nothing else in the text moves — which is what makes the checkbox
   * safe to drive from here.
   */
  const after = useMemo(
    () => assemblePrompt(session, { excludeInstalls }),
    [excludeInstalls, session],
  );

  /** The BEFORE pane: the user's own words, verbatim, from the graph as it arrived. */
  const before = session.versions[0].meta.task;

  /**
   * The kit over the INCLUDED rows only — filtered per member, which lands on
   * the same answer the setup block gives: a shared command survives while any
   * of its members is still included. Empty when everything is ticked out, and
   * COPY stands down rather than flashing COPIED over an empty string.
   */
  const kit = useMemo(
    () =>
      buildInstallBlock(
        applied.filter((s) => hasInstall(s) && !excludeInstalls.has(s.airtableRecordId)),
      ),
    [applied, excludeInstalls],
  );

  /** Is a row's line in play? Checked while any member is still included. */
  const rowChecked = useCallback(
    (row: ResourceRow) =>
      row.command !== null && row.members.some((m) => !excludeInstalls.has(m.airtableRecordId)),
    [excludeInstalls],
  );

  const n = applied.length;
  const parts = impactParts(summary.totals);

  return (
    <div
      className="sg-results-back"
      data-testid="results-backdrop"
      // Both ends of the gesture are read here, off the pointer events, because
      // the browser dispatches a mixed-target CLICK on the common ancestor —
      // this element — where no stopPropagation of the panel's can reach it.
      // See `pressOnBackdrop` for what that protects. Either end that is not a
      // plain left press is left alone entirely — see `closes` — so a gesture
      // aimed at something else never touches the one being tracked.
      onPointerDown={(e) => {
        if (!closes(e)) return;
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        if (!closes(e)) return;
        const pressed = pressOnBackdrop.current;
        pressOnBackdrop.current = false;
        if (pressed && e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        className="sg-results"
        data-testid="results-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sg-results-title"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        {/* ------------------------------------------------------------------ */}
        {/* 1. The summary: what changed, in the impact panel's own figures.    */}
        {/* ------------------------------------------------------------------ */}
        <div className="sg-results-head">
          <div className="sg-results-title-row">
            <h2 className="sg-results-title" id="sg-results-title">
              {n > 0 ? `RESULTS — ${n} upgrade${n === 1 ? '' : 's'} applied` : 'RESULTS'}
            </h2>
            <button
              type="button"
              className="sg-results-close"
              data-testid="results-close"
              ref={closeRef}
              onClick={onClose}
            >
              CLOSE
            </button>
          </div>
          {n === 0 ? (
            // The honest empty state: the window opens at V0 too, and the task
            // as a prompt is a valid prompt — just one no upgrade has improved yet.
            <p className="sg-results-none" data-testid="results-none">
              NO UPGRADES APPLIED YET
            </p>
          ) : (
            <>
              {parts.length > 0 ? (
                <div className="sg-results-metrics" role="group" aria-label="impact">
                  {parts.map((p) => (
                    <span
                      className="sg-results-metric"
                      data-testid="results-metric"
                      key={p.key}
                    >
                      {impactLabel(summary.totals[p.key], p.unit)}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="sg-results-shape">
                <p className="sg-results-count" data-testid="results-count">
                  {summary.complexityBefore.nodes} → {summary.complexityNow.nodes} nodes ·{' '}
                  {summary.complexityBefore.edges} → {summary.complexityNow.edges} edges
                </p>
                <p className="sg-results-count" data-testid="results-pain">
                  pain {summary.painBefore} → {summary.painNow} ({painLabel(summary.painPct)})
                </p>
              </div>
            </>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* 2. The resources: applied rows as includable installs.              */}
        {/* ------------------------------------------------------------------ */}
        <div className="sg-results-resources">
          <div className="sg-results-sec-head">
            <span className="sg-results-cap">APPLIED RESOURCES</span>
            {rows.length > 0 ? (
              <span className="sg-results-kit-copy">
                <span className="sg-results-cap">INSTALL KIT</span>
                <CopyButton text={kit} testId="results-kit-copy" disabled={kit === ''} />
              </span>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <p className="sg-results-none" data-testid="results-rows-none">
              NO RESOURCES APPLIED YET
            </p>
          ) : (
            <ul className="sg-results-rows" data-testid="results-rows">
              {rows.map((row) => (
                <ResourceRowItem
                  key={row.members[0].airtableRecordId}
                  row={row}
                  checked={rowChecked(row)}
                  onToggle={onToggleInstalls}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* 3. The prompt area: the ask beside what the session made of it.     */}
        {/* ------------------------------------------------------------------ */}
        <div className="sg-results-prompts">
          <div className="sg-results-pane">
            <div className="sg-results-sec-head">
              <span className="sg-results-cap">BEFORE — YOUR ORIGINAL ASK</span>
              <CopyButton text={before} testId="results-before-copy" />
            </div>
            {/* tabIndex: a scrollable region the keyboard can reach and arrow through */}
            <pre className="sg-results-text" data-testid="results-before" tabIndex={0}>
              {before}
            </pre>
          </div>
          <div className="sg-results-pane">
            <div className="sg-results-sec-head">
              <span className="sg-results-cap">AFTER — OPTIMIZED PROMPT</span>
              <CopyButton text={after} testId="results-after-copy" />
            </div>
            <pre className="sg-results-text" data-testid="results-after" tabIndex={0}>
              {after}
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
}
