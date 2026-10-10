import { describe, expect, it, beforeEach } from 'vitest';
import {
  ClaimLedger,
  EvidenceBoundError,
  formatOraclePointer,
  resetClaimIdCounterForTests,
} from '../../services/evidenceBound';

describe('ClaimLedger', () => {
  beforeEach(() => resetClaimIdCounterForTests());

  it('appends claims and summarizes statuses', () => {
    const ledger = new ClaimLedger();
    ledger.append({
      text: 'Homepage title is Pricing',
      status: 'measured',
      sources: [{ kind: 'scrape', excerpt: 'Pricing' }],
    });
    ledger.append({ text: 'Rank unknown', status: 'not_measured' });
    expect(ledger.summary()).toEqual({
      measured: 1,
      estimated: 0,
      not_measured: 1,
      unknown: 0,
    });
  });

  it('rejects measured without sources', () => {
    const ledger = new ClaimLedger();
    expect(() => ledger.append({ text: 'fake', status: 'measured' })).toThrow(EvidenceBoundError);
  });

  it('formats Oracle pointer with one action', () => {
    const ledger = new ClaimLedger();
    ledger.append({
      text: 'Crawl ready',
      status: 'measured',
      sources: [{ kind: 'scrape' }],
    });
    const text = formatOraclePointer({ ledger, oneAction: 'Run Instant Audit' });
    expect(text).toContain('[measured] Crawl ready');
    expect(text).toContain('One action: Run Instant Audit');
  });
});
