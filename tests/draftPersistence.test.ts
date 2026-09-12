import { describe, it, expect, beforeEach } from 'vitest';
import { draftPersistenceService, DRAFT_KEYS } from '../services/state/draftPersistenceService';

describe('draftPersistenceService', () => {
  beforeEach(() => {
    draftPersistenceService.clearDraft(DRAFT_KEYS.CHAT_INPUT);
    draftPersistenceService.clearDraft(DRAFT_KEYS.AUDIT_URL);
    draftPersistenceService.clearDraft(DRAFT_KEYS.BUSINESS_DNA_INPUT);
  });

  it('correctly persists and retrieves drafts', () => {
    expect(draftPersistenceService.hasDraft(DRAFT_KEYS.CHAT_INPUT)).toBe(false);
    draftPersistenceService.setDraft(DRAFT_KEYS.CHAT_INPUT, 'How does Luminara rank?');
    expect(draftPersistenceService.hasDraft(DRAFT_KEYS.CHAT_INPUT)).toBe(true);
    expect(draftPersistenceService.getDraft(DRAFT_KEYS.CHAT_INPUT)).toBe('How does Luminara rank?');
  });

  it('clears draft when requested or when empty string is set', () => {
    draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, 'luminarasuite.com');
    expect(draftPersistenceService.getDraft(DRAFT_KEYS.AUDIT_URL)).toBe('luminarasuite.com');

    draftPersistenceService.clearDraft(DRAFT_KEYS.AUDIT_URL);
    expect(draftPersistenceService.hasDraft(DRAFT_KEYS.AUDIT_URL)).toBe(false);
    expect(draftPersistenceService.getDraft(DRAFT_KEYS.AUDIT_URL)).toBe('');

    draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, 'test.com');
    draftPersistenceService.setDraft(DRAFT_KEYS.AUDIT_URL, '');
    expect(draftPersistenceService.hasDraft(DRAFT_KEYS.AUDIT_URL)).toBe(false);
  });
});
