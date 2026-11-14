import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OracleApprovalCard, OracleTurnExtras } from '../components/oracle/OracleTurnExtras';
import type { OracleApprovalCardData } from '../types';

const card = (over: Partial<OracleApprovalCardData> = {}): OracleApprovalCardData => ({
  actionId: '55555555-5555-4555-8555-555555555555',
  preview: 'Start a citation watch on acme.com.\nEngine: chatgpt. Schedule: weekly.',
  costNote: "Uses one of your plan's 3 watch slots.",
  tainted: true,
  expiresAt: Date.now() + 20 * 60 * 1000,
  status: 'pending',
  ...over,
});

describe('Oracle turn extras', () => {
  it('shows the steps Oracle took, marking measured ones', () => {
    const html = renderToStaticMarkup(
      createElement(OracleTurnExtras, {
        steps: [
          { summary: 'Read your project (acme.com)', status: 'ok', measured: false },
          { summary: 'Read your last audit (2026-11-06)', status: 'ok', measured: true },
        ],
      }),
    );
    expect(html).toContain('What Oracle checked');
    expect(html).toContain('Read your project (acme.com)');
    expect(html).toContain('measured');
  });

  it('shows a pending card with its code-built preview, the outside-content warning, and both buttons', () => {
    const html = renderToStaticMarkup(createElement(OracleApprovalCard, { card: card(), onDecide: () => {} }));
    expect(html).toContain('Needs your approval');
    expect(html).toContain('Start a citation watch on acme.com.');
    expect(html).toContain('outside content');
    expect(html).toContain('>Approve<');
    expect(html).toContain('>Reject<');
    expect(html).toMatch(/Expires in (19|20) min/);
  });

  it('shows an expired card as expired, with no buttons', () => {
    const html = renderToStaticMarkup(createElement(OracleApprovalCard, { card: card({ expiresAt: Date.now() - 1000 }) }));
    expect(html).toContain('This card expired');
    expect(html).not.toContain('>Approve<');
  });

  it('never claims done for an unknown outcome', () => {
    const html = renderToStaticMarkup(createElement(OracleApprovalCard, { card: card({ status: 'failed_unknown' }) }));
    expect(html).toContain('could not confirm');
    expect(html).not.toContain('Done.');
  });

  it('uses no agent wording', () => {
    const html = renderToStaticMarkup(
      createElement(OracleTurnExtras, {
        steps: [{ summary: 'Searched "plumbers" (5 results)', status: 'ok', measured: false }],
        cards: [card()],
      }),
    ).toLowerCase();
    expect(html).not.toMatch(/\bagent\b|autonomous|does the work/);
  });
});

describe('a card whose decision did not reach the server', () => {
  it('stays pending with its buttons and shows the note', () => {
    const html = renderToStaticMarkup(
      createElement(OracleApprovalCard, {
        card: card({ summary: 'Could not reach Luminara. Nothing was decided; try again.' }),
        onDecide: () => {},
      }),
    );
    expect(html).toContain('>Approve<');
    expect(html).toContain('Could not reach Luminara');
  });
});
