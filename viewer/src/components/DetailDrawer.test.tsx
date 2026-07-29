import { fireEvent, render, screen } from '@testing-library/react';
import { DetailDrawer } from './DetailDrawer';
import enriched from '../test/fixtures/enriched.workflow.json';
import type { Suggestion, WorkflowNode } from '../graph/types';

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: 'debug-flaky',
  label: 'Debug flaky selectors & timing races',
  kind: 'process',
  description:
    'Re-run single specs over and over to reproduce intermittent failures, chase races with animations and late-loading data.',
  painLevel: 5,
  ...over,
});

const ROWS = enriched.suggestions as Suggestion[];
const matched = (nodeId: string): Suggestion[] => ROWS.filter((s) => s.nodeId === nodeId);
/** The fixture's malformed patch: it deletes a step, then wires an edge into it. */
const BROKEN_ID = 'recD2vT6yG4kQnP8s';
/** Stands in for GraphCanvas's dry run — every patch but the malformed one. */
const dryRun = (id: string) => id !== BROKEN_ID;

it('states the node in full: kind, label, pain, description', () => {
  render(<DetailDrawer node={node()} onClose={() => {}} />);

  expect(screen.getByTestId('detail-drawer')).toBeInTheDocument();
  expect(screen.getByText('Debug flaky selectors & timing races')).toBeInTheDocument();
  expect(screen.getByTestId('drawer-kind')).toHaveTextContent('process');
  expect(screen.getByText(/Re-run single specs over and over/)).toBeInTheDocument();
});

// The card clamps its description to three lines; the drawer is where the whole
// paragraph finally gets read, so the full string must be present verbatim.
it('carries the description unclamped and uncut', () => {
  const n = node();
  render(<DetailDrawer node={n} onClose={() => {}} />);
  expect(screen.getByTestId('drawer-desc')).toHaveTextContent(n.description);
});

it('reuses the five-segment pain meter at the node’s level', () => {
  render(<DetailDrawer node={node({ painLevel: 3 })} onClose={() => {}} />);
  expect(screen.getByTestId('sg-meter')).toHaveAttribute('data-pain', '3');
  expect(screen.getAllByTestId('sg-meter-seg')).toHaveLength(5);
});

// A node the KB matched nothing to says nothing about the KB.
it('holds an empty suggestions section when nothing matched', () => {
  render(<DetailDrawer node={node()} onClose={() => {}} />);
  expect(screen.getByTestId('drawer-suggestions')).toBeEmptyDOMElement();
});

it('states every matched row: category, name, claim', () => {
  const rows = matched('verify-browser');
  render(
    <DetailDrawer
      node={node({ id: 'verify-browser' })}
      onClose={() => {}}
      suggestions={rows}
      canApply={dryRun}
      onApply={() => {}}
    />,
  );

  const cards = screen.getAllByTestId('sg-sug-card');
  expect(cards).toHaveLength(2);
  for (const [i, row] of rows.entries()) {
    expect(cards[i]).toHaveTextContent(row.name);
    expect(cards[i]).toHaveTextContent(row.claim);
    expect(cards[i]).toHaveTextContent(row.category);
  }
});

// The chip's colour is the row's category, and the category lives in a token per
// Airtable select colour — so the class is what the test can hold onto.
it('colours the category chip by category', () => {
  const cat = (rows: Suggestion[]) => {
    const { unmount } = render(
      <DetailDrawer
        node={node()}
        onClose={() => {}}
        suggestions={rows}
        canApply={dryRun}
        onApply={() => {}}
      />,
    );
    const classes = screen.getAllByTestId('sg-sug-cat').map((el) => el.className);
    unmount();
    return classes;
  };

  expect(cat(matched('verify-browser'))).toEqual([
    'sg-sug-cat sg-sug-cat--mcp',
    'sg-sug-cat sg-sug-cat--plugin',
  ]);
  expect(cat(matched('scaffold-repo'))).toEqual(['sg-sug-cat sg-sug-cat--skill']);
  expect(
    cat([{ ...ROWS[0], category: 'Connector' }, { ...ROWS[1], category: 'Other' }]),
  ).toEqual(['sg-sug-cat sg-sug-cat--other', 'sg-sug-cat sg-sug-cat--other']);
});

// The name is the way out to the resource, and the panel must not hand the new
// tab a handle on the viewer.
it('links the name out to the row’s url, safely', () => {
  const [row] = matched('research-docs');
  render(
    <DetailDrawer
      node={node({ id: 'research-docs' })}
      onClose={() => {}}
      suggestions={[row]}
      canApply={dryRun}
      onApply={() => {}}
    />,
  );

  const link = screen.getByRole('link', { name: row.name });
  expect(link).toHaveAttribute('href', row.url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

it('shows the install line only for rows that carry one', () => {
  const rows = matched('verify-browser');
  const [withInstall, without] = rows;
  expect(withInstall.install).toBeTruthy();
  expect(without.install).toBeUndefined();

  render(
    <DetailDrawer
      node={node({ id: 'verify-browser' })}
      onClose={() => {}}
      suggestions={rows}
      canApply={dryRun}
      onApply={() => {}}
    />,
  );

  const installs = screen.getAllByTestId('sg-sug-install');
  expect(installs).toHaveLength(1);
  expect(installs[0]).toHaveTextContent(withInstall.install!);
});

it('offers APPLY on every card', () => {
  const rows = matched('verify-browser');
  const onApply = vi.fn();
  render(
    <DetailDrawer
      node={node({ id: 'verify-browser' })}
      onClose={() => {}}
      suggestions={rows}
      canApply={dryRun}
      onApply={onApply}
    />,
  );

  const buttons = screen.getAllByTestId('sg-sug-apply');
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveTextContent('APPLY');
  for (const b of buttons) expect(b).toBeEnabled();
  expect(screen.queryByTestId('sg-sug-invalid')).not.toBeInTheDocument();

  fireEvent.click(buttons[1]);
  expect(onApply).toHaveBeenCalledWith(rows[1].airtableRecordId);
});

// Generation is fallible: a patch can satisfy the schema and still be one the
// reducer refuses. The card says so instead of offering a button that throws.
it('refuses the patch the dry run cannot apply', () => {
  const rows = matched('scaffold-repo');
  expect(rows[0].airtableRecordId).toBe(BROKEN_ID);
  const onApply = vi.fn();
  render(
    <DetailDrawer
      node={node({ id: 'scaffold-repo' })}
      onClose={() => {}}
      suggestions={rows}
      canApply={dryRun}
      onApply={onApply}
    />,
  );

  const button = screen.getByTestId('sg-sug-apply');
  expect(button).toBeDisabled();
  expect(screen.getByTestId('sg-sug-invalid')).toHaveTextContent('PATCH INVALID');

  fireEvent.click(button);
  expect(onApply).not.toHaveBeenCalled();
});

// The list is as long as the KB made it. A close control that scrolls away with
// the cards leaves the panel with no visible way out, so it lives in a header
// row the scrolling never touches.
it('keeps the close control out of the scrolling region', () => {
  const many: Suggestion[] = Array.from({ length: 7 }, (_, i) => ({
    ...ROWS[0],
    airtableRecordId: `recSTANDIN000000${i}`,
    name: `stand-in ${i}`,
  }));
  render(
    <DetailDrawer
      node={node()}
      onClose={() => {}}
      suggestions={many}
      canApply={dryRun}
      onApply={() => {}}
    />,
  );

  expect(screen.getAllByTestId('sg-sug-card')).toHaveLength(7);
  const scroll = screen.getByTestId('drawer-scroll');
  const x = screen.getByTestId('drawer-close');
  // the X is in the panel but not in the part that scrolls…
  expect(screen.getByTestId('detail-drawer')).toContainElement(x);
  expect(scroll).not.toContainElement(x);
  // …and the list that does the overflowing is
  expect(scroll).toContainElement(screen.getByTestId('drawer-suggestions'));
});

// A panel announced as a dialog, labelled by the step it describes — and not a
// modal one: the graph behind it stays draggable and clickable.
it('announces itself as a dialog labelled by the step', () => {
  const n = node();
  render(<DetailDrawer node={n} onClose={() => {}} />);

  const drawer = screen.getByRole('dialog', { name: n.label });
  expect(drawer).toBe(screen.getByTestId('detail-drawer'));
  expect(drawer).toHaveAttribute('aria-modal', 'false');
});

// A panel focus never enters is a panel a keyboard cannot reach: APPLY would be
// one Tab per remaining card on the graph.
it('takes focus on open, on the way out', () => {
  render(<DetailDrawer node={node()} onClose={() => {}} />);
  expect(document.activeElement).toBe(screen.getByTestId('drawer-close'));
});

// Clicking a second card while the panel is open is another open — focus follows
// the panel's new subject rather than staying where the last one left it.
it('re-takes focus when the panel changes subject', () => {
  const { rerender } = render(<DetailDrawer node={node()} onClose={() => {}} />);
  const x = screen.getByTestId('drawer-close');
  x.blur();
  expect(document.activeElement).not.toBe(x);

  rerender(<DetailDrawer node={node({ id: 'other-step' })} onClose={() => {}} />);
  expect(document.activeElement).toBe(x);
});

// Task 5's apply can consume the very node the drawer describes, so the card to
// return focus to need not still be on the canvas.
it('closes cleanly when the card it came from is gone', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  expect(document.querySelector('.react-flow__node')).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes on the X button', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.click(screen.getByTestId('drawer-close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes on Escape from anywhere', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('ignores every other key', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.keyDown(window, { key: 'a' });
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onClose).not.toHaveBeenCalled();
});

// A listener that outlives its drawer would keep firing onClose for a panel that
// is no longer on screen.
it('stops listening once unmounted', () => {
  const onClose = vi.fn();
  const { unmount } = render(<DetailDrawer node={node()} onClose={onClose} />);

  unmount();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});
