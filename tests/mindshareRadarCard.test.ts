import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MindshareRadarCard } from '../components/visibility/MindshareRadarCard';
import type { EmpiricalEvidence } from '../services/audit/empiricalCitationService';

function evidence(query: string, competitors: string[] = []): EmpiricalEvidence {
  return {
    id: query,
    query,
    intent: 'informational',
    targetDomain: 'example.com',
    brandCited: true,
    brandRank: 1,
    citedUrl: 'https://example.com',
    snippet: 'Example is named.',
    competitorsCited: competitors,
    citationConfidence: 80,
    timestamp: 1,
  };
}

const radarRows: Array<{ query: string; competitors: string; status: 'cited' }> = [
  { query: 'what is example', competitors: 'iana.org', status: 'cited' },
  { query: 'example rfc', competitors: 'packetpushers.net', status: 'cited' },
  { query: 'example dns', competitors: 'stackoverflow.com', status: 'cited' },
];

describe('Who gets named', () => {
  it('uses the radar rivals and citation status, and does not invent a percent or a trend', () => {
    const html = renderToStaticMarkup(createElement(MindshareRadarCard, {
      domain: 'example.com',
      evidence: radarRows.map((row) => evidence(row.query)),
      radarRows,
    }));
    expect(html).toContain('Who gets named');
    expect(html).toContain('iana.org');
    expect(html).toContain('packetpushers.net');
    expect(html).toContain('stackoverflow.com');
    expect(html).toContain('Rivals named in the radar: iana.org, packetpushers.net and stackoverflow.com.');
    expect(html).toContain('A mindshare percent is not shown.');
    expect(html).not.toContain('did not name a competitor');
    expect(html).toContain('Cited');
    expect(html).toContain('First audit, no trend yet');
    expect(html).not.toContain('stable');
    expect(html).not.toMatch(/\d+%/);
  });

  it('shows a trend only when an earlier mindshare percent exists', () => {
    const rows = [evidence('what is example', ['Rival'])];
    const first = renderToStaticMarkup(createElement(MindshareRadarCard, {
      domain: 'example.com',
      evidence: rows,
    }));
    expect(first).toContain('First audit, no trend yet');
    expect(first).toContain('50%');

    const compared = renderToStaticMarkup(createElement(MindshareRadarCard, {
      domain: 'example.com',
      evidence: rows,
      history: [{ timestamp: 1, mindsharePercent: 25 }],
    }));
    expect(compared).toContain('surging');
    expect(compared).not.toContain('First audit, no trend yet');
    expect(compared).toContain('50%');
  });
});
