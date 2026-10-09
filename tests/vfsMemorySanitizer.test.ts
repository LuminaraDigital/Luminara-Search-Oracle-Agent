import { describe, expect, it, beforeEach } from 'vitest';
import { VfsMemoryService } from '../services/vfs/vfsMemoryService';
import { vfsStorageService } from '../services/vfs/vfsStorageService';
import type { BusinessDNA } from '../types';

describe('Dual-Representation Private Memory (ZetaChain Track ZP Pattern 1 & 2)', () => {
  let memoryService: VfsMemoryService;

  beforeEach(() => {
    vfsStorageService.resetToDefaults();
    memoryService = new VfsMemoryService();
  });

  it('syncs BusinessDNA with negativeConstraints into constraints memory category', () => {
    const dna: BusinessDNA = {
      name: 'Acme Corp',
      mission: 'Dominate organic search',
      usp: 'Real-time AI optimization',
      targetAudience: 'Enterprise CMOs',
      competitors: ['RivalSEO', 'OldGuard'],
      perceivedGaps: ['Slow indexing'],
      rawContext: 'Confidential corporate strategy',
      negativeConstraints: [
        'Never mention the 2025 outage',
        'Do not compare pricing with BudgetSEO',
      ],
    };

    const res = memoryService.syncFromBusinessDNA(dna);
    expect(res.syncedCategories).toContain('constraints');
    expect(res.nodesCreated).toBeGreaterThanOrEqual(4);

    const constraintItems = memoryService.getMemoryItems('constraints');
    expect(constraintItems.length).toBe(2);
    expect(constraintItems.map((c) => c.title)).toContain('Never mention the 2025 outage');
    expect(constraintItems.map((c) => c.title)).toContain('Do not compare pricing with BudgetSEO');
  });

  it('projects raw local memories into a sanitized prompt instruction block', () => {
    memoryService.addMemoryItem(
      'preferences',
      'Tone Preferences',
      'Authoritative, concise, executive tone. No fluff.',
    );
    memoryService.addMemoryItem(
      'entities',
      'Key Partner: GlobalCorp',
      'Key partner contact: admin@globalcorp.com or call 555-123-4567.',
    );
    const fakeKey = `sk-${'a'.repeat(24)}`;
    memoryService.addMemoryItem(
      'constraints',
      'Strict: Banned Claim',
      `Do not mention secret internal key ${fakeKey}.`,
    );

    const projection = memoryService.getSanitizedMemoryProjection();

    expect(projection.neverBringUp).toContain('Strict: Banned Claim');
    expect(projection.whoMatters).toContain('Key Partner: GlobalCorp');
    expect(projection.sanitizedPromptBlock).toContain('STRICT NEGATIVE CONSTRAINTS (NEVER BRING UP):');
    expect(projection.sanitizedPromptBlock).toContain('Strict: Banned Claim');

    // Verify PII & Secret Redaction
    expect(projection.sanitizedPromptBlock).not.toContain('admin@globalcorp.com');
    expect(projection.sanitizedPromptBlock).not.toContain(fakeKey);
    expect(projection.sanitizedPromptBlock).toContain('[REDACTED_EMAIL]');
    expect(projection.sanitizedPromptBlock).toContain('[REDACTED_API_KEY]');
    expect(projection.redactionsCount).toBeGreaterThanOrEqual(2);
  });
});
