import { describe, expect, it } from 'vitest';
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
});
