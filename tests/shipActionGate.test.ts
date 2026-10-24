import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShipActionGate } from '../components/audit/ShipActionGate';
import {
  readShipCommitment,
  writeShipCommitment,
  type ShipCommitment,
} from '../services/audit/shipCommitmentService';

describe('shipCommitmentService', () => {
  it('round-trips a ship commitment', () => {
    const domain = 'example.com';
    const markdown = '# Luminara: Will AI mention Example?\n## 1. One move this week\nShip schema.';
    const commitment: ShipCommitment = {
      actionId: 'deploy-schema',
      label: 'Ship schema / structured data',
      committedAt: 1_700_000_000_000,
    };
    writeShipCommitment(domain, markdown, commitment);
    expect(readShipCommitment(domain, markdown)).toEqual(commitment);
  });

  it('returns null when nothing was committed', () => {
    expect(readShipCommitment('missing.example', '# fresh report body unique')).toBeNull();
  });

  it('names the next fix as a business identity tag', () => {
    const html = renderToStaticMarkup(createElement(ShipActionGate, {
      domain: 'example.com',
      markdownText: '# Report',
      hasEvidence: false,
      sourceCount: 0,
      onCommitted: () => undefined,
    }));
    expect(html).toContain('Add a business identity tag');
    expect(html).toContain('Add a business identity tag so search tools can tell who you are.');
    expect(html).not.toContain('Ship schema');
    expect(html).not.toContain('structured data');
    expect(html).not.toContain('Schema.org');
    expect(html).not.toContain('\u2014');
  });
});
